import { useEffect, useMemo, useState } from 'react'
import { Bot, Folder, GitBranch, Plug, ScrollText, Trash2 } from 'lucide-react'
import { EffortMenu, FolderMenu, ModelMenu } from '@/components/ChatPanel'
import { folderRootsFor, useStore, type GtNode } from '@/lib/store'
import { gitBranch, guardAllow, guardAllowed, guardRevoke, guardRules, type GuardRule } from '@/lib/bridge'
import { shouldOffer } from '@/lib/compact'
import { band, contextUse, fmtTokens } from '@/lib/usage'
import {
  PERMISSION_HINT,
  PERMISSION_LABEL,
  PERMISSIONS,
  PROVIDER_ACCENT,
  PROVIDER_LABEL,
} from '@/lib/types'
import { cn } from '@/lib/utils'

type ChipKind = 'folder' | 'skill' | 'agent' | 'mcp'

const CHIP_ICON: Record<ChipKind, typeof Folder> = {
  folder: Folder,
  skill: ScrollText,
  agent: Bot,
  mcp: Plug,
}

/** A labelled row. The label column is fixed so the values form a column too. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-line-soft px-3 py-1.5 last:border-b-0">
      <span className="w-[74px] shrink-0 font-mono text-[9.5px] text-fg-faint">{label}</span>
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
    </div>
  )
}


/**
 * Give this agent its own checkout of the repository it is working in.
 *
 * Two agents in one directory interleave their writes, and the canvas cannot
 * see it happen: the diff that lands is unattributable and the second agent
 * reads files the first is halfway through changing. A worktree costs a
 * directory and buys an agent that can be reviewed, reverted and merged on its
 * own terms.
 *
 * The branch it is already on is shown rather than the button, when it has
 * one: an agent that says `wt/reviewer` has answered the question the button
 * was there to ask.
 */
function IsolateControl({ nodeId, cwd }: { nodeId: string; cwd: string | null }) {
  const isolate = useStore((s) => s.isolateSession)
  const [branch, setBranch] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    if (!cwd) return setBranch(null)
    void gitBranch(cwd)
      .then((b) => live && setBranch(b))
      .catch(() => live && setBranch(null))
    return () => {
      live = false
    }
  }, [cwd])

  const own = branch?.startsWith('wt/') === true

  const run = async () => {
    setBusy(true)
    setError(null)
    const out = await isolate(nodeId)
    setBusy(false)
    if ('error' in out) setError(out.error)
    else setBranch(out.branch)
  }

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <GitBranch size={10} className="shrink-0 text-fg-faint" />
        <span
          className={cn('min-w-0 flex-1 truncate font-mono text-[10px]', own ? 'text-[var(--color-live)]' : 'text-fg-muted')}
          title={own ? 'This agent has its own checkout' : 'Shared with every other agent in this folder'}
        >
          {branch ?? (cwd ? 'no branch' : 'no folder')}
        </span>
        {!own && cwd && (
          <button
            onClick={() => void run()}
            disabled={busy}
            title="Create a git worktree for this agent and work there instead"
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg disabled:text-fg-faint"
          >
            {busy ? 'branching…' : 'isolate'}
          </button>
        )}
      </span>
      {error && (
        <span className="font-mono text-[9px] leading-snug text-[var(--color-danger)]">{error}</span>
      )}
    </span>
  )
}


/**
 * The verdict, and the button that asks for one.
 *
 * Deliberately not hidden behind a passing state: the reason to look at an
 * agent is often to ask again after changing something by hand, and a control
 * that disappears when the news is good is a control you cannot find when you
 * need it.
 */
function CheckControl({ nodeId }: { nodeId: string }) {
  const command = useStore((s) => s.checkCommand)
  const setDialog = useStore((s) => s.setCanvasDialog)
  const run = useStore((s) => s.runCheckFor)
  const check = useStore((s) => {
    const n = s.nodes.find((x) => x.id === nodeId)
    return n?.type === 'session' ? n.data.check : undefined
  })

  if (!command.trim()) {
    return (
      <button
        onClick={() => setDialog('rules')}
        className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-fg-subtle hover:text-fg-muted"
        title="Set a command — the project's own tests — and it runs after any turn that writes"
      >
        not set — add one
      </button>
    )
  }

  const running = check?.state === 'running'
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-mono text-[10px]',
          check?.state === 'pass' && 'text-[var(--color-live)]',
          check?.state === 'fail' && 'text-[var(--color-danger)]',
          !check && 'text-fg-faint',
          running && 'text-fg-muted',
        )}
        title={check?.tail || check?.error || command}
      >
        {running
          ? 'running…'
          : check?.state === 'pass'
            ? `pass${check.ms ? ` · ${(check.ms / 1000).toFixed(1)}s` : ''}`
            : check?.state === 'fail'
              ? check.error
                ? 'could not run'
                : `fail${check.code == null ? '' : ` · exit ${check.code}`}`
              : 'not run yet'}
      </span>
      <button
        onClick={() => void run(nodeId)}
        disabled={running}
        title={`Run: ${command}`}
        className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg disabled:text-fg-faint"
      >
        {running ? '…' : 'check'}
      </button>
    </span>
  )
}


/**
 * How full this agent's window is, and the way out when it is nearly gone.
 *
 * The button appears only past the line: an offer to recycle a window that is
 * a fifth full is noise, and noise beside a meter is how people learn to stop
 * reading meters.
 */
function ContextControl({ nodeId }: { nodeId: string }) {
  const compact = useStore((s) => s.compact)
  const node = useStore((s) =>
    s.nodes.find((n): n is GtNode & { type: 'session' } => n.id === nodeId && n.type === 'session'),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!node) return null
  const use = contextUse({ ...node.data, id: nodeId })
  const compactions = node.data.compactions ?? 0

  const run = async () => {
    setBusy(true)
    setError(null)
    const out = await compact(nodeId)
    setBusy(false)
    if (out) setError(out.error)
  }

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-[10px]',
            band(use?.fraction ?? null) === 'hot' ? 'text-[var(--color-danger)]' : 'text-fg-muted',
          )}
          title={
            (use?.limit
              ? `${use.tokens.toLocaleString()} of ${use.limit.toLocaleString()} tokens in the last turn`
              : 'The window for this model is unknown, so there is no percentage to show') +
            (compactions > 0
              ? `\nThis window has been recycled ${compactions} time${compactions === 1 ? '' : 's'}; the notes are on the canvas.`
              : '')
          }
        >
          {use?.fraction != null
            ? `${Math.round(use.fraction * 100)}% full`
            : use
              ? `${fmtTokens(use.tokens)} carried`
              : 'no turns yet'}
          {/* Short enough to sit beside the percentage in a 268px panel; the
              tooltip says what it means. */}
          {compactions > 0 && <span className="text-fg-faint"> · ↻{compactions}</span>}
        </span>
        {(shouldOffer(use?.fraction) || busy) && (
          <button
            onClick={() => void run()}
            disabled={busy}
            title="Write a handover note to the canvas, then continue in a fresh window carrying only that note"
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-attn)] hover:bg-surface disabled:text-fg-faint"
          >
            {busy ? 'compacting…' : 'compact'}
          </button>
        )}
      </span>
      {error && (
        <span className="font-mono text-[9px] leading-snug text-[var(--color-danger)]">{error}</span>
      )}
    </span>
  )
}


/**
 * What this agent has been let past, and the switch that lets it.
 *
 * Per agent, never per canvas: allowing this one to push is not a statement
 * about the other five, and an approval that leaked sideways would be the
 * worst kind of surprise. Read from disk rather than from the store — the
 * allow file is what the shim actually consults, and a checkbox that showed
 * anything else would be describing a permission that isn't in force.
 */
function GuardControl({ sessionId }: { sessionId: string }) {
  const guards = useStore((s) => s.guards)
  const setDialog = useStore((s) => s.setCanvasDialog)
  const [allowed, setAllowed] = useState<string[]>([])
  const [rules, setRules] = useState<GuardRule[]>([])

  useEffect(() => {
    let live = true
    void Promise.all([guardRules(), guardAllowed(sessionId)])
      .then(([r, a]) => {
        if (!live) return
        setRules(r)
        setAllowed(a)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [sessionId])

  const toggle = async (rule: string, on: boolean) => {
    // Optimistic, then reconciled from the file: the shim reads the file, so
    // the file is the truth about what this agent may do.
    setAllowed((prev) => (on ? [...prev, rule] : prev.filter((r) => r !== rule)))
    await (on ? guardAllow(sessionId, rule) : guardRevoke(sessionId, rule)).catch(() => {})
    await guardAllowed(sessionId)
      .then(setAllowed)
      .catch(() => {})
  }

  if (guards.length === 0) {
    return (
      <button
        onClick={() => setDialog('rules')}
        className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-fg-subtle hover:text-fg-muted"
        title="Nothing is held back on this canvas. Set what to ask about in the canvas rules."
      >
        nothing held back
      </button>
    )
  }

  return (
    <span className="flex min-w-0 flex-1 flex-wrap gap-1">
      {guards
        .filter((g) => rules.some((r) => r.id === g))
        .map((g) => {
          const on = allowed.includes(g)
          const what = rules.find((r) => r.id === g)?.what ?? g
          return (
            <button
              key={g}
              onClick={() => void toggle(g, !on)}
              title={
                on
                  ? `Allowed: this agent may ${what}. Click to hold it back again.`
                  : `Held back: ${what} is refused before it runs. Click to allow it for this agent.`
              }
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                on
                  ? 'bg-[color-mix(in_oklch,var(--color-live)_20%,transparent)] text-[var(--color-live)]'
                  : 'bg-surface-2 text-fg-subtle hover:text-fg-muted',
              )}
            >
              {on ? `${g} allowed` : g}
            </button>
          )
        })}
    </span>
  )
}

/**
 * Everything about one agent, beside that agent.
 *
 * These controls used to live in a docked panel, which had two costs. It held
 * an edge of the window whether or not anything was selected, and it could
 * only ever describe one agent — so comparing two meant clicking between them
 * and holding the difference in your head.
 *
 * This is a React Flow node toolbar, which means it follows its node when
 * dragged, keeps its size through any zoom, and — the part the panel could not
 * do — appears once per selected node. Select two agents and you get two
 * inspectors, side by side, saying how they differ.
 */
export function SessionInspector({ nodeId }: { nodeId: string }) {
  // Read the live node rather than take one as a prop: the menus below act on
  // it, and acting on a copy captured at render time is how a control ends up
  // writing to a node that has since changed.
  const node = useStore((s) =>
    s.nodes.find((n): n is GtNode & { type: 'session' } => n.id === nodeId && n.type === 'session'),
  )
  const rename = useStore((s) => s.renameSession)
  // The directory this agent actually runs in: its primary folder if one is
  // wired in, else whatever it was spawned with.
  const cwd = useStore((s) => {
    const mine = s.nodes.find((n) => n.id === nodeId)
    if (mine?.type !== 'session') return null
    return folderRootsFor(s.nodes, s.edges, nodeId).find((r) => r.primary)?.path ?? mine.data.cwd ?? null
  })
  const setPermission = useStore((s) => s.setPermission)
  const removeNode = useStore((s) => s.removeNode)

  /**
   * What is wired into this agent, as chips — the graph, read back as a list.
   *
   * Selected as one string, then parsed. A selector that builds an array of
   * objects returns new references on every store tick, so `useShallow` never
   * finds it equal and the component re-renders itself forever. The node does
   * the same thing with its folder list, for the same reason.
   */
  const wiredKey = useStore((s) => {
    const mine = s.nodes.find((n) => n.id === nodeId)
    const skillIds = mine?.type === 'session' ? mine.data.skillIds : []
    const rows: string[] = []

    for (const r of folderRootsFor(s.nodes, s.edges, nodeId)) {
      rows.push(`folder\u0000${r.path.split('/').filter(Boolean).pop() ?? r.path}`)
    }
    for (const n of s.nodes) {
      if (n.type === 'skill' && skillIds.includes(n.data.skillId)) {
        rows.push(`skill\u0000${n.data.name}`)
      }
    }
    // Agents that feed this one context, named rather than counted: "2
    // sources" is not something you can act on.
    for (const e of s.edges) {
      if (e.type !== 'context' || e.target !== nodeId) continue
      const from = s.nodes.find((n) => n.id === e.source)
      if (from?.type === 'session') rows.push(`agent\u0000${from.data.name}`)
    }
    for (const n of s.nodes) {
      if (n.type !== 'mcp') continue
      if (!s.edges.some((e) => e.source === n.id && e.target === nodeId)) continue
      rows.push(`mcp\u0000${n.data.name}`)
    }
    return rows.join('\n')
  })

  const wired = useMemo(
    () =>
      (wiredKey ? wiredKey.split('\n') : []).map((row, i) => {
        const [kind, label] = row.split('\u0000')
        return { key: `${i}:${row}`, kind: kind as ChipKind, label }
      }),
    [wiredKey],
  )


  // Deleted out from under its own inspector, which is a normal way for this
  // to end — the delete button is right there.
  if (!node) return null
  const d = node.data

  return (
    <div
      // Typing a name in here must never trip a canvas shortcut, and a wheel
      // over it must not zoom the canvas out from under it.
      data-shortcuts="off"
      className="nowheel w-[268px] overflow-hidden rounded-xl border border-line-strong bg-panel/95 text-left backdrop-blur"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 bg-surface-2/70 px-3 py-1.5">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: PROVIDER_ACCENT[d.provider] }}
        />
        <input
          value={d.name}
          onChange={(e) => rename(nodeId, e.target.value)}
          spellCheck={false}
          title="Rename this agent"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11.5px] text-fg outline-none hover:border-line focus:border-line-strong focus:bg-canvas"
        />
        <span className="shrink-0 font-mono text-[9px] text-fg-faint">
          {d.role === 'orchestrator' ? 'orchestrator' : 'agent'}
        </span>
        <button
          onClick={() => removeNode(nodeId)}
          title="Delete this agent"
          className="shrink-0 rounded p-0.5 text-fg-subtle hover:bg-surface hover:text-[var(--color-danger)]"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <Field label="provider">
        {/* Not editable: the provider decides which CLI runs, which session id
            resumes it, and which models exist. Changing it would not change
            this agent so much as replace it — so spawn a new one. */}
        <span className="truncate font-mono text-[10px] text-fg-muted">
          {PROVIDER_LABEL[d.provider]}
        </span>
      </Field>
      <Field label="model">
        <ModelMenu node={node} />
      </Field>
      <Field label="effort">
        <EffortMenu node={node} />
      </Field>
      <Field label="folder">
        <FolderMenu node={node} />
      </Field>
      <Field label="branch">
        <IsolateControl nodeId={nodeId} cwd={cwd} />
      </Field>
      <Field label="check">
        <CheckControl nodeId={nodeId} />
      </Field>
      <Field label="window">
        <ContextControl nodeId={nodeId} />
      </Field>
      <Field label="ask before">
        <GuardControl sessionId={d.sessionId} />
      </Field>
      <Field label="access">
        <span className="flex min-w-0 flex-wrap gap-0.5">
          {PERMISSIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPermission(nodeId, p)}
              title={PERMISSION_HINT[p]}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                d.permission === p
                  ? p === 'full'
                    ? 'bg-[color-mix(in_oklch,var(--color-danger)_22%,transparent)] text-[var(--color-danger)]'
                    : 'bg-surface-3 text-fg'
                  : 'text-fg-subtle hover:bg-surface',
              )}
            >
              {PERMISSION_LABEL[p]}
            </button>
          ))}
        </span>
      </Field>

      <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2">
        <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">WIRED IN</span>
        {wired.length === 0 ? (
          <p className="text-[10.5px] leading-snug text-fg-faint">
            Nothing yet. Drag from this node's left edge to give it a folder, a skill, or another
            agent's context.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {wired.map((w) => {
              const Icon = CHIP_ICON[w.kind]
              return (
                <span
                  key={w.key}
                  className="flex items-center gap-1.5 rounded border border-line bg-surface px-1.5 py-0.5"
                  title={w.kind}
                >
                  <Icon size={9} className="shrink-0 text-fg-subtle" />
                  <span className="max-w-[92px] truncate font-mono text-[9.5px] text-fg-muted">
                    {w.label}
                  </span>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
