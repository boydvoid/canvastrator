import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowDown, ArrowUp, FolderOpen, Hexagon, Plus, SlidersHorizontal, Trash2, TriangleAlert, X } from 'lucide-react'
import { Composer } from '@/components/Composer'
import { PlanPanel } from '@/components/PlanPanel'
import { AgentMessage } from '@/components/AgentMessage'
import { RunningStatus } from '@/components/RunningStatus'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { pickPath } from '@/lib/bridge'
import {
  basename,
  canvasFilesFor,
  folderRootsFor,
  resolveCwd,
  searchRootsFor,
  useStore,
  type FolderRoot,
  type GtNode,
} from '@/lib/store'
import {
  EFFORTS,
  EFFORT_HINT,
  MODEL_OPTIONS,
  modelLabel,
  PERMISSION_HINT,
  PERMISSION_LABEL,
  PROVIDER_ACCENT,
  PROVIDER_LABEL,
  type Message,
  type Permission,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const PERMISSIONS: Permission[] = ['plan', 'auto', 'full']

function Bubble({ msg, accent }: { msg: Message; accent: string }) {
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

function ModelMenu({ node }: { node: GtNode & { type: 'session' } }) {
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
function EffortMenu({ node }: { node: GtNode & { type: 'session' } }) {
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
function FolderMenu({ node }: { node: GtNode & { type: 'session' } }) {
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

/**
 * Everything about an agent that used to be printed on its node.
 *
 * The node is a label now, so this is where a name is changed, a standing brief
 * is written, and an agent is deleted — one place per setting, next to the
 * conversation it affects.
 */
function SessionSettings({ node }: { node: GtNode & { type: 'session' } }) {
  const rename = useStore((s) => s.renameSession)
  const setPermission = useStore((s) => s.setPermission)
  const setInstructions = useStore((s) => s.setInstructions)
  const removeNode = useStore((s) => s.removeNode)
  const skills = useStore(
    useShallow((s) =>
      s.nodes.filter(
        (n): n is GtNode & { type: 'skill' } =>
          n.type === 'skill' && node.data.skillIds.includes(n.data.skillId),
      ),
    ),
  )
  const d = node.data

  return (
    <div className="shrink-0 space-y-2 border-b border-line-soft bg-surface/30 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-[10px] text-fg-faint">name</span>
        <input
          value={d.name}
          onChange={(e) => rename(node.id, e.target.value)}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none focus:border-line-strong"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => removeNode(node.id)}
          title="Delete this agent"
        >
          <Trash2 size={12} />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <span className="shrink-0 font-mono text-[10px] text-fg-faint">access</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {PERMISSIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPermission(node.id, p)}
              title={PERMISSION_HINT[p]}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                d.permission === p ? 'bg-surface-3 text-fg' : 'text-fg-subtle hover:bg-surface',
              )}
            >
              {PERMISSION_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={d.instructions ?? ''}
        onChange={(e) => setInstructions(node.id, e.target.value)}
        placeholder="Standing brief — sent with every turn. e.g. You review code. Read what you are pointed at and report only."
        spellCheck={false}
        className="h-20 w-full resize-none rounded border border-line bg-canvas px-1.5 py-1 font-mono text-[10.5px] leading-relaxed text-fg-muted outline-none placeholder:text-fg-faint focus:border-line-strong focus:text-fg"
      />

      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skills.map((sk) => (
            <span
              key={sk.id}
              className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted"
            >
              {sk.data.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Chat with any agent on the canvas without hunting for its node.
 *
 * The node transcripts and this one are the same conversation — both read the
 * store — so a reply streaming into a node appears here too.
 */
export function ChatPanel() {
  const nodes = useStore((s) => s.nodes)
  // Subscribed, not read once: which folder is primary is an edge *type*, so
  // promoting one changes no node and this panel would otherwise show the old
  // working directory until something else re-rendered it.
  const edges = useStore((s) => s.edges)
  const chatTarget = useStore((s) => s.chatTarget)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const send = useStore((s) => s.send)
  const interrupt = useStore((s) => s.interrupt)
  const setPermission = useStore((s) => s.setPermission)
  const plan = useStore((s) => s.plan)

  const sessions = useMemo(
    () => nodes.filter((n): n is GtNode & { type: 'session' } => n.type === 'session'),
    [nodes],
  )

  // Default to the orchestrator: it's the one you talk to most, and a stale
  // target (a killed session) must not leave the panel pointing at nothing.
  const active =
    sessions.find((n) => n.id === chatTarget) ??
    sessions.find((n) => n.data.role === 'orchestrator') ??
    sessions[0]

  // Collapsed by default: this is configuration, and the conversation is why
  // the panel is open at all.
  const [showSettings, setShowSettings] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAtBottom(stick.current)
  }

  // Follow the stream, but stop the moment the user scrolls up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [active?.data.messages])

  // Switching agents starts you at the end of that conversation.
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      stick.current = true
      setAtBottom(true)
    }
  }, [active?.id])

  if (!active) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center font-mono text-[11px] text-fg-faint">
        no sessions yet — right-click the canvas to add one
      </div>
    )
  }

  const d = active.data
  const accent = PROVIDER_ACCENT[d.provider]
  const busy = d.state === 'thinking' || d.state === 'streaming'
  const cwd = resolveCwd(nodes, edges, active.id)
  // Extras get a count here too, so the composer footer and the node never
  // disagree about how many folders this agent has.
  // Counted against the primary flag rather than by subtracting one from the
  // length: with no `cwd` edge, length - 1 reads "0 extras" beside "no folder"
  // while a folder really is wired in.
  const folderRoots = folderRootsFor(nodes, edges, active.id)
  const extraFolders = folderRoots.filter((r) => !r.primary).length

  const jump = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    stick.current = true
    setAtBottom(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* who you're talking to */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-surface">
              <Hexagon
                size={11}
                style={{ color: accent }}
                fill={d.role === 'orchestrator' ? accent : 'transparent'}
                className="shrink-0"
              />
              <span className="truncate font-mono text-[11.5px] text-fg">{d.name}</span>
              <span className="shrink-0 text-fg-faint">▾</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Agents on this canvas</DropdownMenuLabel>
            {sessions.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={() => setChatTarget(n.id)}
                className="justify-between"
              >
                <span className="flex items-center gap-2">
                  <Hexagon
                    size={10}
                    style={{ color: PROVIDER_ACCENT[n.data.provider] }}
                    fill={n.data.role === 'orchestrator' ? PROVIDER_ACCENT[n.data.provider] : 'transparent'}
                  />
                  {n.data.name}
                </span>
                <span className="font-mono text-[9.5px] text-fg-faint">{n.data.state}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ModelMenu node={active} />
        <EffortMenu node={active} />
        <FolderMenu node={active} />

        <button
          onClick={() =>
            setPermission(active.id, PERMISSIONS[(PERMISSIONS.indexOf(d.permission) + 1) % 3])
          }
          className={cn(
            'ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]',
            d.permission === 'full'
              ? 'bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]'
              : 'text-fg-subtle hover:bg-surface',
          )}
          title="Permission — click to change"
        >
          {PERMISSION_LABEL[d.permission]}
        </button>
        {busy && d.notice && (
          <span
            className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted"
            title={d.notice.detail}
          >
            {d.notice.label}
          </span>
        )}
        <button
          onClick={() => setShowSettings((v) => !v)}
          title={showSettings ? 'Hide settings' : 'Name, access, standing brief'}
          className={cn(
            'shrink-0 rounded p-1 hover:bg-surface',
            showSettings ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
          )}
        >
          <SlidersHorizontal size={12} />
        </button>
      </div>

      {showSettings && <SessionSettings node={active} />}

      {/* The plan sits with the agent that wrote it — it is that
          conversation's proposal, not the canvas's. */}
      {plan?.fromNodeId === active.id && <PlanPanel plan={plan} />}

      {busy && (
        <div className="shrink-0 border-b border-line-soft px-2.5 py-1">
          <RunningStatus data={d} nodeId={active.id} />
        </div>
      )}

      {!busy && d.awaitingUser && (
        <div
          className="shrink-0 border-b border-line-soft px-2.5 py-1.5 font-mono text-[10.5px]"
          style={{
            background: 'color-mix(in oklch, var(--color-claude) 10%, transparent)',
            color: 'var(--color-claude)',
          }}
        >
          {d.name} asked you something and is waiting.
        </div>
      )}

      {/* transcript */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {d.messages.length === 0 && (
          <p className="py-8 text-center font-mono text-[11px] text-fg-faint">
            {cwd ? cwd.replace(/^\/Users\/[^/]+/, '~') : 'no folder wired in'}
          </p>
        )}
        {d.messages.map((m) => (
          <Bubble key={m.id} msg={m} accent={accent} />
        ))}
      </div>

      {!atBottom && (
        <button
          onClick={jump}
          className="pointer-events-auto absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-panel px-2 py-1 font-mono text-[10px] text-fg-muted shadow-lg hover:bg-surface-2"
        >
          <ArrowDown size={10} /> latest
        </button>
      )}

      {/* composer */}
      <div className="shrink-0 border-t border-line-soft p-2">
        <Composer
          placeholder={busy ? 'running…' : `Message ${d.name}   ↵ send · ⇧↵ newline · / commands · @ files`}
          busy={busy}
          cwd={cwd}
          roots={searchRootsFor(nodes, edges, active.id)}
          canvasFiles={canvasFilesFor(nodes)}
          provider={d.provider}
          liveCommands={[...(d.commands ?? []), ...(d.skills ?? [])]}
          onSend={(text) => void send(active.id, text)}
          onInterrupt={() => void interrupt(active.id)}
        />
        <div className="mt-1 flex items-center gap-2 font-mono text-[9.5px] text-fg-faint">
          <span className="truncate">{cwd ? `▸ ${cwd.split('/').filter(Boolean).pop()}` : '▸ no folder'}</span>
          {extraFolders > 0 && <span className="shrink-0">+{extraFolders}</span>}
          <span className="ml-auto shrink-0">
            {d.usage.outputTokens > 0 && `${d.usage.outputTokens} out`}
            {d.usage.costUsd > 0 && ` · $${d.usage.costUsd.toFixed(3)}`}
          </span>
        </div>
      </div>
    </div>
  )
}
