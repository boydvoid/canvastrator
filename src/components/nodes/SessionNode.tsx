import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { CircleAlert, Hexagon, Loader2 } from 'lucide-react'
import { folderRootsFor, useStore, type GtNode } from '@/lib/store'
import { PROVIDER_ACCENT, PROVIDER_LABEL, type SessionNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The tail of what the agent is saying, live.
 *
 * Not the transcript — that lived on the node once and made every node a
 * window big enough to read, which is what left the graph unreadable. This is
 * two lines of the newest reply, scrolled to the end, so a canvas of working
 * agents shows what each of them is actually doing without opening anything.
 * Reading the whole thing is still the dock's job.
 */
function StreamWindow({ text, streaming, accent, notice }: {
  text: string
  streaming: boolean
  accent: string
  notice?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Follow the stream. No stick-on-scroll here — the window is two lines tall
  // and not something you read by scrolling; that's what the dock is for.
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  if (!text) {
    return (
      <div className="h-[26px] overflow-hidden font-mono text-[10px] leading-[13px] text-fg-faint">
        {streaming ? (notice ?? 'thinking…') : ''}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="h-[26px] overflow-hidden font-mono text-[10px] leading-[13px] break-words whitespace-pre-wrap text-fg-muted"
    >
      {text}
      {streaming && (
        <span
          className="gt-caret ml-0.5 inline-block h-[9px] w-[5px] translate-y-[1px]"
          style={{ background: accent }}
        />
      )}
    </div>
  )
}

/**
 * An agent on the canvas: who it is, whether it is working, and the tail of
 * what it is saying.
 *
 * The full transcript used to live here, which made every node a window that
 * had to be big enough to read and left the graph unreadable at any zoom that
 * showed more than three agents. The conversation and every setting now live
 * in the right dock; clicking a node points the dock at it.
 */
function SessionNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'session' }>) {
  const d = data as SessionNodeData
  // Steps this agent proposed that are still waiting on the user. A plan is
  // the loudest thing on a canvas — nothing is running because of it.
  const awaitingApproval = useStore((s) =>
    s.plan?.fromNodeId === id ? s.plan.steps.filter((st) => st.state === 'pending').length : 0,
  )
  // Folders come from the graph, not from node state — the wiring is the
  // truth. Selected as one string because a selector that builds an array
  // returns a new one every store tick and would re-render on every token.
  // Primacy is encoded rather than left to position: `folderRootsFor` sorts
  // primary-first but cannot promise one exists, and reading index 0 as the
  // working directory renders an orphaned extra root as the cwd.
  const folderKey = useStore((s) =>
    folderRootsFor(s.nodes, s.edges, id)
      .map((r) => `${r.primary ? '*' : '-'}${r.missing ? '!' : ''}${r.path}`)
      .join('\n'),
  )
  const folders = useMemo(() => (folderKey ? folderKey.split('\n') : []), [folderKey])
  const primary = folders.find((f) => f.startsWith('*'))
  const cwd = primary ? primary.replace(/^\*!?/, '') : null
  const cwdMissing = primary?.startsWith('*!') ?? false
  const extras = folders.length - (primary ? 1 : 0)
  // Which conversation the dock is showing, so the two are visibly the same
  // thing rather than a node and an unrelated chat.
  const inDock = useStore(
    (s) =>
      s.libraryOpen &&
      s.rightTab === 'chat' &&
      (s.chatTarget === id || (s.chatTarget === null && d.role === 'orchestrator')),
  )

  const accent = PROVIDER_ACCENT[d.provider]
  const busy = d.state === 'thinking' || d.state === 'streaming'

  // The newest thing the agent said. Markdown is left as it was typed: at ten
  // pixels the punctuation is texture, and parsing it per node per token is
  // work for a window nobody reads word by word.
  const tail = useMemo(() => {
    const last = [...d.messages].reverse().find((m) => m.role === 'assistant' && m.text)
    // Enough to fill the window a few times over, so the scroll-to-end lands
    // mid-sentence rather than on a stale line.
    return last ? last.text.slice(-400) : ''
  }, [d.messages])

  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!d.firedAt) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 700)
    return () => clearTimeout(t)
  }, [d.firedAt])

  return (
    <div
      className={cn(
        'gt-spawn flex h-full w-full cursor-pointer flex-col gap-0.5 overflow-hidden rounded-xl border bg-panel/90 px-3 py-2 backdrop-blur transition-colors',
        selected || inDock ? 'border-line-strongest' : 'border-line',
        busy && 'gt-thinking',
        flash && 'gt-firing',
        d.state === 'error' && 'border-[var(--color-danger)]',
      )}
      style={
        {
          '--accent': accent,
          '--accent-dim': `color-mix(in oklch, ${accent} 30%, transparent)`,
          ...(d.role === 'orchestrator'
            ? { borderColor: `color-mix(in oklch, ${accent} 55%, transparent)` }
            : {}),
        } as React.CSSProperties
      }
      title={[
        `${d.name} · ${PROVIDER_LABEL[d.provider]}`,
        // The working directory is only worth naming as such when there is
        // something else it could be confused with.
        ...folders.map((f) => {
          const path = f.replace(/^[*-]!?/, '')
          if (f[1] === '!') return `${path} — folder not found`
          return folders.length > 1 && f.startsWith('*') ? `${path} (cwd)` : path
        }),
        'Click to open in the panel',
      ].join('\n')}
    >
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

      <div className="flex min-w-0 items-center gap-2">
        <Hexagon
          size={13}
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
        {busy ? (
          <Loader2 size={12} className="shrink-0 animate-spin" style={{ color: accent }} />
        ) : d.state === 'error' ? (
          <CircleAlert size={12} className="shrink-0 text-[var(--color-danger)]" />
        ) : d.awaitingUser ? (
          <span
            className="gt-caret h-2 w-2 shrink-0 rounded-full"
            style={{ background: 'var(--color-claude)' }}
            title="This agent ended its turn with a question — it's waiting on you."
          />
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-1.5 font-mono text-[9.5px] text-fg-faint">
        <span className="shrink-0">{PROVIDER_LABEL[d.provider]}</span>
        {/* A count, never a list: the node is a fixed 260×106 and the paths
            live in the tooltip and the folder menu in the dock. */}
        <span
          className={cn('truncate', cwdMissing && 'text-[var(--color-danger)]')}
        >
          {cwd ? `▸ ${cwd.split('/').filter(Boolean).pop()}` : '▸ no folder'}
        </span>
        {extras > 0 && (
          <span className="shrink-0" title={`${extras} more folder${extras > 1 ? 's' : ''} attached`}>
            +{extras}
          </span>
        )}
        {busy && <span className="ml-auto shrink-0" style={{ color: accent }}>{d.state}</span>}
        {!busy && d.state === 'dead' && <span className="ml-auto shrink-0">dead</span>}
      </div>

      {/* Pointer-events off: the window is something to glance at, and a click
          anywhere on the node belongs to the node. */}
      <div className="pointer-events-none mt-1 border-t border-line-soft pt-1">
        <StreamWindow
          text={tail}
          streaming={busy}
          accent={accent}
          notice={d.notice?.label}
        />
      </div>
    </div>
  )
}

export const SessionNode = memo(SessionNodeInner)
