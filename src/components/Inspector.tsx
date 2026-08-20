import { useMemo } from 'react'
import { Folder, ScrollText, Trash2, Bot, Plug } from 'lucide-react'
import { EffortMenu, FolderMenu, ModelMenu } from '@/components/ChatPanel'
import { folderRootsFor, useStore, type GtNode } from '@/lib/store'
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
