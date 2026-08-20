import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeToolbar, Position, useViewport, type NodeProps } from '@xyflow/react'
import { ChevronRight, ChevronsUpDown, CircleAlert, Hexagon, Minimize2 } from 'lucide-react'
import { AgentMessage } from '@/components/AgentMessage'
import { SessionInspector } from '@/components/Inspector'
import { cycleDensity, densityOf, DENSITY_SIZE, type Density } from '@/lib/density'
import { liveVerb } from '@/lib/liveverb'
import { folderRootsFor, useStore, type GtNode } from '@/lib/store'
import { summarizeTurn } from '@/lib/summary'
import { elapsed } from '@/lib/pulse'
import { band, contextUse, fmtUsd } from '@/lib/usage'
import { PROVIDER_ACCENT, PROVIDER_LABEL, type SessionNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

const BAND_COLOR = {
  calm: 'var(--color-live)',
  warm: 'var(--color-claude)',
  hot: 'var(--color-danger)',
} as const

/**
 * A clock that only ticks while something is happening.
 *
 * An interval per idle node, on a canvas of twenty, is twenty timers waking the
 * app up to redraw a number that has not changed.
 */
function useElapsed(since: number | undefined, live: boolean): string | null {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!live || !since) return
    const t = setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live, since])
  return live && since ? elapsed(since) : null
}

/**
 * How full this agent's window is, as a hairline.
 *
 * Not a progress bar — there is no such thing here, since nothing reports how
 * far through a turn it is, and drawing an invented one would be the app
 * claiming to know something it does not. This is the one number that
 * genuinely predicts the failure you cannot recover from, drawn at the size it
 * deserves on a node you are only glancing at.
 */
function ContextRail({ session }: { session: SessionNodeData }) {
  const use = contextUse({ ...session, id: '' })
  const tone = band(use?.fraction ?? null)
  return (
    <div
      className="h-[2px] w-full shrink-0 bg-line"
      title={
        use
          ? `Last turn carried ${use.tokens.toLocaleString()} context tokens${
              use.limit ? ` of ${use.limit.toLocaleString()}` : ' — window unknown for this model'
            }`
          : 'No turn has run yet, so this agent has no context to measure.'
      }
    >
      {use?.fraction != null && (
        <div
          className="h-full transition-[width] duration-500"
          style={{ width: `${Math.max(1.5, use.fraction * 100)}%`, background: BAND_COLOR[tone] }}
        />
      )}
    </div>
  )
}

/** The tail of a reply, following itself as it streams. */
function StreamTail({ text, accent }: { text: string; accent: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <div
      ref={ref}
      className="max-h-[52px] overflow-hidden text-[11.5px] leading-[1.42] break-words whitespace-pre-wrap text-fg-muted"
    >
      {text}
      <span
        className="gt-caret ml-0.5 inline-block h-[9px] w-[5px] translate-y-[1px]"
        style={{ background: accent }}
      />
    </div>
  )
}

/**
 * An agent on the canvas, at whichever density the view calls for.
 *
 * The three are the same node, not three components: `glance` is what survives
 * when the canvas is showing a squad, `summary` is the default and the answer
 * to "what is going on", and `full` is a decision you make about one agent.
 * See `density.ts` for why zoom picks between the first two and never the
 * third.
 */
function SessionNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'session' }>) {
  const d = data as SessionNodeData
  const { zoom } = useViewport()
  const density = densityOf(d.density, zoom)
  const setDensity = useStore((s) => s.setDensity)
  const setChatTarget = useStore((s) => s.setChatTarget)

  const accent = PROVIDER_ACCENT[d.provider]
  const busy = d.state === 'thinking' || d.state === 'streaming'
  const verb = liveVerb(d)
  const since = useElapsed(d.turnStartedAt, busy)

  // Steps this agent proposed that are still waiting on the user. A plan is
  // the loudest thing on a canvas — nothing is running because of it.
  const awaitingApproval = useStore((s) =>
    s.plan?.fromNodeId === id ? s.plan.steps.filter((st) => st.state === 'pending').length : 0,
  )

  // Folders come from the graph, not from node state — the wiring is the
  // truth. Selected as one string because a selector that builds an array
  // returns a new one every store tick and would re-render on every token.
  const folderKey = useStore((s) =>
    folderRootsFor(s.nodes, s.edges, id)
      .map((r) => `${r.primary ? '*' : '-'}${r.missing ? '!' : ''}${r.path}`)
      .join('\n'),
  )
  const folders = useMemo(() => (folderKey ? folderKey.split('\n') : []), [folderKey])
  const primary = folders.find((f) => f.startsWith('*'))
  const cwd = primary ? primary.replace(/^\*!?/, '') : null
  const cwdMissing = primary?.startsWith('*!') ?? false

  /**
   * The last completed turn, reduced to the sentence it opens with and the
   * tools it reached for. This is the agent's own account — no second model
   * summarises it, so there is nothing here to be wrong about.
   */
  const last = useMemo(
    () => [...d.messages].reverse().find((m) => m.role === 'assistant' && m.text && !m.pending),
    [d.messages],
  )
  const summary = useMemo(() => (last ? summarizeTurn(last) : null), [last])

  /** What is arriving right now, which outranks the last finished turn. */
  const streaming = useMemo(() => {
    const pending = [...d.messages].reverse().find((m) => m.pending && m.text)
    return pending ? pending.text.slice(-400) : ''
  }, [d.messages])

  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!d.firedAt) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 700)
    return () => clearTimeout(t)
  }, [d.firedAt])

  const verbColor =
    verb.tone === 'danger'
      ? 'var(--color-danger)'
      : verb.tone === 'accent'
        ? accent
        : 'var(--color-fg-faint)'

  const open = (next: Density | undefined) => setDensity(id, next)

  return (
    <div
      onClick={() => setChatTarget(id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        // Double-click is the shortcut past the ladder: whatever this node is
        // showing, it opens. Closing again is the same gesture on a full node.
        open(density === 'full' ? undefined : 'full')
      }}
      style={
        {
          width: DENSITY_SIZE[density].w,
          '--accent': accent,
          '--accent-dim': `color-mix(in oklch, ${accent} 30%, transparent)`,
        } as React.CSSProperties
      }
      className={cn(
        'gt-spawn flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-panel/90 backdrop-blur transition-colors',
        selected ? 'border-line-strongest' : 'border-line',
        busy && 'gt-thinking',
        flash && 'gt-firing',
        d.state === 'error' && 'border-[var(--color-danger)]',
        d.awaitingUser && d.state === 'idle' && 'border-[var(--color-danger)]',
      )}
      title={[
        `${d.name} · ${PROVIDER_LABEL[d.provider]}`,
        ...folders.map((f) => {
          const path = f.replace(/^[*-]!?/, '')
          if (f[1] === '!') return `${path} — folder not found`
          return folders.length > 1 && f.startsWith('*') ? `${path} (cwd)` : path
        }),
        density === 'full' ? 'Double-click to close' : 'Double-click to open',
      ].join('\n')}
    >
      {/* Selecting an agent brings its controls to it. A node toolbar rather
          than a panel: it follows the node when dragged, holds its size through
          any zoom, and appears once per selection — so two selected agents give
          two inspectors instead of one panel that can only describe one. */}
      <NodeToolbar isVisible={selected} position={Position.Right} align="start" offset={14}>
        <SessionInspector nodeId={id} />
      </NodeToolbar>

      {/* One direction only: everything an agent is given enters on the left,
          everything it produces leaves on the right. Keep the flow handles
          first — an edge that doesn't name a handle falls through to the first
          of its type. */}
      <Handle type="target" position={Position.Left} id="context-in" style={{ top: '28%' }} />
      <Handle type="target" position={Position.Left} id="spawned-by" style={{ top: '54%' }} />
      <Handle type="target" position={Position.Left} id="attach" style={{ top: '80%' }} />
      <Handle type="source" position={Position.Right} id="context-out" style={{ top: '28%' }} />
      <Handle type="source" position={Position.Right} id="spawns" style={{ top: '54%' }} />
      <Handle type="source" position={Position.Right} id="produces" style={{ top: '80%' }} />

      {/* ── Identity ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 items-center gap-2 px-3 pt-2 pb-1.5">
        <Hexagon
          size={12}
          style={{ color: accent }}
          fill={d.role === 'orchestrator' ? accent : 'transparent'}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{d.name}</span>
        {awaitingApproval > 0 && !busy && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px]"
            style={{
              background: 'color-mix(in oklch, var(--color-claude) 20%, transparent)',
              color: 'var(--color-claude)',
            }}
            title={`${awaitingApproval} step${awaitingApproval > 1 ? 's' : ''} waiting for your approval`}
          >
            plan {awaitingApproval}
          </span>
        )}
        {d.state === 'error' ? (
          <CircleAlert size={12} className="shrink-0 text-[var(--color-danger)]" />
        ) : density !== 'glance' ? (
          // Truncates before the name does. A full model id is long enough to
          // push a name off the node, and the name is the identity — the model
          // is a detail you can read in the tooltip or the inspector.
          <span
            className="max-w-[45%] shrink truncate font-mono text-[9.5px] text-fg-faint"
            title={`${PROVIDER_LABEL[d.provider]}${d.model ? ` · ${d.model}` : ''}`}
          >
            {PROVIDER_LABEL[d.provider].toLowerCase()}
            {d.model ? ` · ${d.model}` : ''}
          </span>
        ) : (
          since && <span className="shrink-0 font-mono text-[9.5px] text-fg-faint">{since}</span>
        )}
      </div>

      {/* ── What it is doing, right now ──────────────────────────────── */}
      <div className="flex min-w-0 items-center gap-1.5 px-3 pb-2">
        <ChevronRight size={11} className="shrink-0" style={{ color: verbColor }} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" style={{ color: verbColor }}>
          {verb.text}
        </span>
        {density === 'glance' ? (
          cwd && (
            <span className={cn('shrink-0 font-mono text-[9.5px] text-fg-faint', cwdMissing && 'text-[var(--color-danger)]')}>
              {cwd.split('/').filter(Boolean).pop()}
            </span>
          )
        ) : (
          since && <span className="shrink-0 font-mono text-[9.5px] text-fg-faint">{since}</span>
        )}
      </div>

      <ContextRail session={d} />

      {/* ── The last turn, in the agent's own words ──────────────────── */}
      {density !== 'glance' && (
        <div className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
          {streaming ? (
            <StreamTail text={streaming} accent={accent} />
          ) : summary?.headline ? (
            <p className="line-clamp-3 text-[11.5px] leading-[1.42] text-fg-muted">
              {summary.headline}
            </p>
          ) : (
            <p className="text-[11.5px] leading-[1.42] text-fg-faint">
              {cwd
                ? 'Nothing said yet. Send it something.'
                : 'No folder wired in — this agent will refuse the turn rather than run somewhere surprising.'}
            </p>
          )}

          {summary && summary.tools.length > 0 && !streaming && (
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {summary.tools.map((t) => (
                <span
                  key={t}
                  className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-fg-subtle"
                >
                  {t}
                </span>
              ))}
              {summary.toolCount > summary.tools.length && (
                <span className="font-mono text-[9px] text-fg-faint">
                  +{summary.toolCount - summary.tools.length}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── The conversation, only when asked for ────────────────────── */}
      {density === 'full' && (
        <div
          // The transcript scrolls, and a wheel over it must scroll it rather
          // than zoom the canvas out from under the thing being read.
          className="nowheel max-h-[240px] min-w-0 space-y-3 overflow-y-auto border-t border-line-soft px-3 py-3"
          data-shortcuts="off"
        >
          {d.messages.length === 0 && (
            <p className="font-mono text-[10.5px] text-fg-faint">No turns yet.</p>
          )}
          {d.messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11.5px] leading-snug text-fg">
                  {m.text}
                </p>
              </div>
            ) : m.role === 'system' ? (
              <p
                key={m.id}
                className={cn(
                  'font-mono text-[10.5px] leading-snug',
                  m.error ? 'text-[var(--color-danger)]' : 'text-fg-faint',
                )}
              >
                {m.text}
              </p>
            ) : (
              <div key={m.id} className="text-[11.5px] leading-snug">
                <AgentMessage text={m.text} streaming={m.pending} provider={d.provider} />
                {m.tools.length > 0 && (
                  <p className="mt-1 truncate font-mono text-[9.5px] text-fg-faint">
                    {m.tools.map((t) => t.name).join(' · ')}
                  </p>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {/* ── What it has cost, and the way back down the ladder ───────── */}
      {density !== 'glance' && (
        <div className="flex min-w-0 items-center gap-2.5 border-t border-line-soft bg-canvas/40 px-3 py-1.5 font-mono text-[9.5px] text-fg-subtle">
          <span
            className={cn('shrink-0 truncate', cwdMissing && 'text-[var(--color-danger)]')}
            title={cwd ?? 'No folder wired in'}
          >
            {cwd ? cwd.split('/').filter(Boolean).pop() : 'no folder'}
          </span>
          <span className="shrink-0 tabular-nums">{fmtUsd(d.usage.costUsd)}</span>
          <span className="shrink-0">{d.permission}</span>
          <button
            className="ml-auto shrink-0 rounded p-0.5 text-fg-faint hover:bg-surface-2 hover:text-fg"
            title={
              d.density
                ? 'Pinned. Click to follow the zoom again.'
                : 'Following the zoom. Click to pin the next density.'
            }
            onClick={(e) => {
              e.stopPropagation()
              // Cycling from an unpinned node pins the *next* rung, so the
              // first click always changes what you see. Landing back on the
              // rung the zoom would have chosen releases the pin instead of
              // holding a value that agrees with it by coincidence.
              const next = cycleDensity(density)
              open(densityOf(undefined, zoom) === next ? undefined : next)
            }}
          >
            {density === 'full' ? <Minimize2 size={11} /> : <ChevronsUpDown size={11} />}
          </button>
        </div>
      )}
    </div>
  )
}

export const SessionNode = memo(SessionNodeInner)
