import { useMemo, useState } from 'react'
import { ArrowUp, FolderOpen, Plus, TriangleAlert, X } from 'lucide-react'
import { AgentMessage } from '@/components/AgentMessage'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { pickPath } from '@/lib/bridge'
import {
  basename,
  folderRootsFor,
  useStore,
  type FolderRoot,
  type GtNode,
} from '@/lib/store'
import {
  EFFORTS,
  EFFORT_HINT,
  MODEL_OPTIONS,
  modelLabel,
  PROVIDER_LABEL,
  type Message,
} from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The parts a conversation is made of: a message bubble, and the menus that
 * change how the next turn runs.
 *
 * This file was a docked chat panel. The panel is gone — the chatbox owns the
 * conversation, and an agent node at full density owns its own transcript —
 * but the pieces it was assembled from are used by both, so they stay here
 * rather than being copied into each.
 */

export function Bubble({ msg, accent }: { msg: Message; accent: string }) {
  if (msg.role === 'system') {
    return (
      <div className="rounded-md border border-dashed border-line-strong px-2.5 py-1.5 font-mono text-[11px] text-fg-subtle">
        {msg.text}
      </div>
    )
  }
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-lg rounded-br-sm bg-surface-2 px-3 py-2 text-[12.5px] leading-[1.6] break-words whitespace-pre-wrap text-fg">
          {msg.text}
        </div>
      </div>
    )
  }
  if (msg.error) {
    return (
      <div className="rounded-md border border-[color-mix(in_oklch,var(--color-danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-2.5 py-2 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-[var(--color-danger)]">
        {msg.text}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {msg.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Array.from(new Set(msg.tools.map((t) => t.name))).map((name) => (
            <span
              key={name}
              className="rounded bg-surface px-1.5 py-0.5 font-mono text-[9.5px] text-fg-subtle"
            >
              {name}
            </span>
          ))}
        </div>
      )}
      {(msg.text || msg.pending) && (
        <div className="min-w-0">
          <AgentMessage text={msg.text} streaming={!!msg.pending} />
          {msg.pending && (
            <span
              className="gt-caret ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px]"
              style={{ background: accent }}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function ModelMenu({ node }: { node: GtNode & { type: 'session' } }) {
  const setModel = useStore((s) => s.setModel)
  const [custom, setCustom] = useState(false)
  const options = MODEL_OPTIONS[node.data.provider]

  if (custom) {
    return (
      <input
        autoFocus
        defaultValue={node.data.model ?? ''}
        placeholder="model id"
        onBlur={(e) => {
          setModel(node.id, e.target.value.trim() || undefined)
          setCustom(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setCustom(false)
        }}
        className="w-28 rounded border border-line-strong bg-canvas px-1 font-mono text-[10px] text-fg outline-none"
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg-muted"
          title="Model for this session"
        >
          {node.data.model ? modelLabel(node.data.provider, node.data.model) : 'default'} ▾
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setModel(node.id, undefined)}>
          default ({PROVIDER_LABEL[node.data.provider]})
        </DropdownMenuItem>
        {options.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => setModel(node.id, m.id)} title={m.id}>
            {m.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTimeout(() => setCustom(true), 0)}>
          Custom…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Effort for a live session — and the one setting here that acts immediately.
 *
 * Changing it mid-turn stops the running turn and re-runs it, so the label says
 * so before you click: raising effort because a reply is going badly is the
 * whole reason to reach for this, and silently applying it to the *next* reply
 * would be the opposite of what was asked for.
 */
export function EffortMenu({ node }: { node: GtNode & { type: 'session' } }) {
  const setEffort = useStore((s) => s.setEffort)
  const d = node.data
  const busy = d.state === 'thinking' || d.state === 'streaming'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg-muted"
          title={
            busy
              ? 'Reasoning effort — changing it now restarts this turn'
              : 'Reasoning effort for this session'
          }
        >
          {d.effort ?? 'effort'} ▾
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{busy ? 'Effort — restarts this turn' : 'Effort'}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setEffort(node.id, undefined)}>
          default (provider)
        </DropdownMenuItem>
        {EFFORTS.map((e) => (
          <DropdownMenuItem key={e} onSelect={() => setEffort(node.id, e)} title={EFFORT_HINT[e]}>
            {e}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const shortPath = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

/**
 * One folder in the menu. At module scope on purpose: `FolderMenu` subscribes
 * to `s.nodes`, which changes on every streamed token, and a component defined
 * inside it gets a fresh identity every render — the rows would remount per
 * token with the menu open, dropping hover and flickering the ✕ and ↑ buttons
 * out from under the pointer.
 */
function FolderRow({
  root,
  onPromote,
  onDetach,
}: {
  root: FolderRoot
  onPromote: () => void
  onDetach: () => void
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded px-1.5 py-1',
        !root.primary && 'cursor-pointer hover:bg-surface',
      )}
      onClick={root.primary ? undefined : onPromote}
      title={root.primary ? root.path : `${root.path}\nClick to make this the working folder`}
    >
      {root.missing ? (
        <TriangleAlert size={11} className="shrink-0 text-[var(--color-danger)]" />
      ) : (
        <FolderOpen size={11} className="shrink-0 text-fg-muted" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[11px] text-fg">{basename(root.path)}</span>
        <span
          className={cn(
            'block truncate font-mono text-[9.5px]',
            root.missing ? 'text-[var(--color-danger)]' : 'text-fg-faint',
          )}
        >
          {root.missing ? 'folder not found' : shortPath(root.path)}
        </span>
      </span>
      {!root.primary && (
        <button
          className="h-5 w-5 shrink-0 rounded text-fg-faint opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg-muted"
          title="Make this the working folder"
          onClick={(e) => {
            e.stopPropagation()
            onPromote()
          }}
        >
          <ArrowUp size={11} className="mx-auto" />
        </button>
      )}
      <button
        className="h-5 w-5 shrink-0 rounded text-fg-faint opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg-muted"
        // The node stays: it may be the working folder of another session, and
        // an unwired folder node is a state the canvas already handles.
        title="Detach from this agent — the folder node stays on the canvas"
        onClick={(e) => {
          e.stopPropagation()
          onDetach()
        }}
      >
        <X size={11} className="mx-auto" />
      </button>
    </div>
  )
}

/**
 * The folders this session can reach, and the only place they are editable
 * without drawing an edge.
 *
 * A session's folders live entirely in the graph — one `cwd` edge is the
 * working directory, any number of `attach` edges are extra roots — so this
 * menu is a view onto edges, not a setting of its own. It sits with the model
 * and effort pickers because that is where the rest of this session's
 * configuration already is.
 */
export function FolderMenu({ node }: { node: GtNode & { type: 'session' } }) {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const attachFolder = useStore((s) => s.attachFolder)
  const detachFolder = useStore((s) => s.detachFolder)
  const setPrimaryFolder = useStore((s) => s.setPrimaryFolder)

  const roots = useMemo(() => folderRootsFor(nodes, edges, node.id), [nodes, edges, node.id])
  const primary = roots.find((r) => r.primary)
  const extras = roots.filter((r) => !r.primary)

  const add = async () => {
    const picked = await pickPath(true)
    if (picked) attachFolder(node.id, picked)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex min-w-0 shrink items-center rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-surface',
            primary ? 'text-fg-subtle hover:text-fg-muted' : 'text-[var(--color-danger)]',
          )}
          title="Folders this agent can reach"
        >
          <span className="truncate">
            {primary ? `▸ ${basename(primary.path)}` : '▸ no folder'}
          </span>
          {extras.length > 0 && <span className="shrink-0">&nbsp;+{extras.length}</span>}
          <span className="shrink-0">&nbsp;▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Working folder</DropdownMenuLabel>
        <div className="max-h-64 overflow-y-auto px-1">
          {primary ? (
            <FolderRow
              root={primary}
              onPromote={() => setPrimaryFolder(node.id, primary.nodeId)}
              onDetach={() => detachFolder(node.id, primary.nodeId)}
            />
          ) : (
            <p className="px-1.5 py-1 font-mono text-[10px] text-fg-faint">
              none — this agent can't be sent to until it has one
            </p>
          )}
          {extras.length > 0 && (
            <>
              <DropdownMenuLabel>Also reachable</DropdownMenuLabel>
              {extras.map((r) => (
                <FolderRow
                  key={r.nodeId}
                  root={r}
                  onPromote={() => setPrimaryFolder(node.id, r.nodeId)}
                  onDetach={() => detachFolder(node.id, r.nodeId)}
                />
              ))}
            </>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void add()}>
          <Plus size={11} /> Add folder…
        </DropdownMenuItem>
        {/* The one place this is said. Extra roots are absolute paths the agent
            is told about — whether it is allowed to read them is the provider's
            decision, not a grant this app can make. */}
        <p className="px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-fg-faint">
          Extra folders are context, not access: the agent is told their
          absolute paths, and{primary ? ` runs in ${basename(primary.path)}` : ' runs in the working folder'}.
          Project skills and MCP servers come from the working folder only.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
