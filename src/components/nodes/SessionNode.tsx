import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import {
  CircleStop,
  Eye,
  Hexagon,
  Pencil,
  ShieldAlert,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentMessage } from '@/components/AgentMessage'
import { RunningStatus } from '@/components/RunningStatus'
import { resolveCwd, useStore, type GtNode } from '@/lib/store'
import {
  PERMISSION_HINT,
  PERMISSION_LABEL,
  PROVIDER_ACCENT,
  PROVIDER_LABEL,
  modelLabel,
  type Message,
  type Permission,
  type SessionNodeData,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const STATE_COPY: Record<SessionNodeData['state'], string> = {
  idle: 'idle',
  thinking: 'thinking',
  streaming: 'streaming',
  error: 'error',
  dead: 'dead',
}

/**
 * Tool activity, collapsed by default. A working agent emits dozens of these
 * and they drown the prose that actually answers the question.
 */
function ToolTrail({ tools }: { tools: { name: string; detail: string }[] }) {
  const [open, setOpen] = useState(false)
  if (!tools.length) return null

  const summary = Array.from(new Set(tools.map((t) => t.name))).slice(0, 3).join(' · ')

  return (
    <div className="my-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg-muted"
      >
        <Wrench size={9} className="shrink-0" />
        <span className="shrink-0">
          {tools.length} {tools.length === 1 ? 'action' : 'actions'}
        </span>
        <span className="truncate opacity-60">{summary}</span>
        <span className="ml-auto shrink-0 opacity-60">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-0.5 space-y-0.5 border-l border-line pl-2">
          {tools.map((t, i) => (
            <div key={i} className="flex min-w-0 gap-1.5 font-mono text-[10px] text-fg-subtle">
              <span className="shrink-0 text-fg-muted">{t.name}</span>
              {t.detail && <span className="truncate opacity-70">{t.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Bubble({ msg, accent }: { msg: Message; accent: string }) {
  if (msg.role === 'system') {
    return (
      <div className="rounded-md border border-dashed border-line-strong px-2 py-1.5 font-mono text-[10.5px] break-words text-fg-subtle">
        {msg.text}
      </div>
    )
  }
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-surface-2 px-2.5 py-1.5 text-[12.5px] leading-[1.6] break-words text-fg whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    )
  }
  // Errors are provider text, not markdown — render them literally.
  if (msg.error) {
    return (
      <div className="space-y-1">
        <ToolTrail tools={msg.tools} />
        <div className="rounded-md border border-[color-mix(in_oklch,var(--color-danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-2 py-1.5 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-[var(--color-danger)]">
          {msg.text}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <ToolTrail tools={msg.tools} />
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

const PERMISSION_CYCLE: Permission[] = ['plan', 'auto', 'full']
const PERMISSION_ICON = { plan: Eye, auto: Pencil, full: ShieldAlert } as const

/** Cycles read-only → edit → full. Always visible: an agent's write access
 *  should never be something you have to open a panel to discover. */
function PermissionBadge({ value, onChange }: { value: Permission; onChange: (p: Permission) => void }) {
  const Icon = PERMISSION_ICON[value]
  return (
    <button
      onClick={() => onChange(PERMISSION_CYCLE[(PERMISSION_CYCLE.indexOf(value) + 1) % 3])}
      title={`${PERMISSION_LABEL[value]} — ${PERMISSION_HINT[value]}\nClick to change.`}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
        value === 'full'
          ? 'bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]'
          : value === 'plan'
            ? 'text-fg-subtle hover:bg-surface'
            : 'text-fg-muted hover:bg-surface',
      )}
    >
      <Icon size={10} />
      {PERMISSION_LABEL[value]}
    </button>
  )
}

function SessionNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'session' }>) {
  const d = data as SessionNodeData
  const interrupt = useStore((s) => s.interrupt)
  const removeNode = useStore((s) => s.removeNode)
  const rename = useStore((s) => s.renameSession)
  const setPermission = useStore((s) => s.setPermission)
  // Must be shallow-compared: a fresh array every render would loop forever.
  const skills = useStore(
    useShallow((s) =>
      s.nodes.filter(
        (n): n is GtNode & { type: 'skill' } =>
          n.type === 'skill' && d.skillIds.includes(n.data.skillId),
      ),
    ),
  )

  // cwd comes from the graph, not from node state — the wiring is the truth.
  const cwd = useStore((s) => resolveCwd(s.nodes, s.edges, id))
  // Which conversation the right dock is showing, so the two views are
  // visibly the same thing rather than two separate chats.
  const inDock = useStore(
    (s) =>
      s.libraryOpen &&
      s.rightTab === 'chat' &&
      (s.chatTarget === id ||
        (s.chatTarget === null && d.role === 'orchestrator')),
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const accent = PROVIDER_ACCENT[d.provider]
  const busy = d.state === 'thinking' || d.state === 'streaming'

  // Follow the stream, but stop the moment the user scrolls up to read — and
  // start following again when they come back down. Tracked on scroll rather
  // than measured after the write, because by then the new text has already
  // moved the bottom out from under them.
  const stick = useRef(true)
  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [d.messages])

  // A restored canvas opens on the end of the conversation, not the start.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

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
        'gt-spawn flex h-full w-full flex-col overflow-hidden rounded-xl border bg-panel/90 backdrop-blur transition-colors',
        selected ? 'border-line-strongest' : 'border-line',
        busy && 'gt-thinking',
        flash && 'gt-firing',
      )}
      style={
        {
          '--accent': accent,
          '--accent-dim': `color-mix(in oklch, ${accent} 30%, transparent)`,
          ...(d.role === 'orchestrator' ? { borderColor: `color-mix(in oklch, ${accent} 55%, transparent)` } : {}),
        } as React.CSSProperties
      }
    >
      <NodeResizer minWidth={300} minHeight={220} lineClassName="opacity-0" handleClassName="opacity-0" />

      {/* Two axes, two meanings. Sideways is configuration: what the user
          wires in to set the session up, and context passed between peers on
          the same row. Downward is the flow itself — what this agent spawned
          and what it produced. Keep the sideways handles first: edges that
          don't name a handle fall through to the first of their type. */}
      <Handle type="target" position={Position.Left} id="context-in" style={{ top: 34 }} />
      <Handle type="target" position={Position.Left} id="attach" style={{ top: 62 }} />
      <Handle type="source" position={Position.Right} id="context-out" style={{ top: 34 }} />
      <Handle type="target" position={Position.Top} id="spawned-by" />
      <Handle type="source" position={Position.Bottom} id="produces" />

      {/* header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line-soft px-2.5 py-1.5">
        <Hexagon
          size={12}
          style={{ color: accent }}
          fill={d.role === 'orchestrator' ? accent : 'transparent'}
          className="shrink-0"
        />
        <input
          value={d.name}
          onChange={(e) => rename(id, e.target.value)}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-fg outline-none focus:text-fg-strong"
          spellCheck={false}
        />
        {inDock && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: accent }}
            title="Shown in the chat panel"
          />
        )}
        <span className="shrink-0 font-mono text-[10px] text-fg-subtle">
          {PROVIDER_LABEL[d.provider]}
        </span>
        <PermissionBadge value={d.permission} onChange={(p) => setPermission(id, p)} />
        {d.awaitingUser && !busy && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
            style={{
              background: 'color-mix(in oklch, var(--color-claude) 22%, transparent)',
              color: 'var(--color-claude)',
            }}
            title="This agent ended its turn with a question — it's waiting on you."
          >
            waiting on you
          </span>
        )}
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]',
            d.state === 'error'
              ? 'bg-[color-mix(in_oklch,var(--color-danger)_20%,transparent)] text-[var(--color-danger)]'
              : busy
                ? 'text-fg'
                : 'text-fg-subtle',
          )}
          style={busy ? { background: `color-mix(in oklch, ${accent} 18%, transparent)` } : undefined}
        >
          {STATE_COPY[d.state]}
        </span>
        {busy && (
          <Button
            variant="danger"
            size="icon"
            onClick={() => void interrupt(id)}
            title="Interrupt this turn"
          >
            <CircleStop size={12} />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => removeNode(id)} title="Delete session">
          <Trash2 size={12} />
        </Button>
      </header>

      {/* A slow turn must show it's alive, or it reads as a hung agent. */}
      {busy && (
        <div className="shrink-0 border-b border-line-soft px-2.5 py-0.5">
          <RunningStatus data={d} nodeId={id} />
        </div>
      )}

      {/* transcript */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="nodrag nowheel min-h-0 flex-1 space-y-2.5 overflow-y-auto overflow-x-hidden px-2.5 py-2"
      >
        {d.messages.length === 0 && (
          <p className="py-6 text-center font-mono text-[11px] text-fg-faint">
            {cwd
              ? `${cwd.replace(/^\/Users\/[^/]+/, '~')} · click to chat`
              : 'wire a folder node in to set a working directory'}
          </p>
        )}
        {d.messages.map((m) => (
          <Bubble key={m.id} msg={m} accent={accent} />
        ))}
      </div>

      {/* Replying happens in the chat panel — a composer per node meant a
          dozen text boxes competing for the same job. What stays is the
          transcript and the strip that says how this session is configured. */}
      <div className="shrink-0 border-t border-line-soft p-2">
        <div className="flex items-center gap-2 overflow-hidden">
          {skills.map((sk) => (
            <span
              key={sk.id}
              className="shrink-0 truncate rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted"
            >
              {sk.data.name}
            </span>
          ))}
          <span
            className={cn(
              'shrink-0 truncate font-mono text-[10px]',
              cwd ? 'text-fg-faint' : 'text-[var(--color-danger)]',
            )}
            title={cwd ?? 'no folder attached'}
          >
            {cwd ? `▸ ${cwd.split('/').filter(Boolean).pop()}` : '▸ no folder'}
          </span>
          {/* Only shown when pinned: silence means the provider's own default. */}
          {d.effort && (
            <span
              className="shrink-0 truncate font-mono text-[10px] text-fg-faint"
              title={`Reasoning effort: ${d.effort}`}
            >
              {d.effort}
            </span>
          )}
          {d.model && (
            <span
              className="shrink-0 truncate font-mono text-[10px] text-fg-faint"
              title={`Running on ${d.model}`}
            >
              {modelLabel(d.provider, d.model)}
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">
            {d.usage.outputTokens > 0 && `${d.usage.outputTokens} out`}
            {d.usage.costUsd > 0 && ` · $${d.usage.costUsd.toFixed(3)}`}
          </span>
        </div>
      </div>
    </div>
  )
}

export const SessionNode = memo(SessionNodeInner)
