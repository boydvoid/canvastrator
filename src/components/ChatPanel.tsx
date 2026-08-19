import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Hexagon } from 'lucide-react'
import { Composer } from '@/components/Composer'
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
import { canvasFilesFor, resolveCwd, searchRootsFor, useStore, type GtNode } from '@/lib/store'
import {
  EFFORTS,
  EFFORT_HINT,
  PERMISSION_LABEL,
  PROVIDER_ACCENT,
  PROVIDER_LABEL,
  type Message,
  type Permission,
  type Provider,
} from '@/lib/types'
import { cn } from '@/lib/utils'

/** Model shorthands worth one click. Anything else goes in via Custom. */
const MODEL_PRESETS: Record<Provider, string[]> = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: ['gpt-5.1-codex', 'o3'],
  opencode: [],
}

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
  const presets = MODEL_PRESETS[node.data.provider]

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
          {node.data.model ?? 'default'} ▾
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setModel(node.id, undefined)}>
          default ({PROVIDER_LABEL[node.data.provider]})
        </DropdownMenuItem>
        {presets.map((m) => (
          <DropdownMenuItem key={m} onSelect={() => setModel(node.id, m)}>
            {m}
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

/**
 * Chat with any agent on the canvas without hunting for its node.
 *
 * The node transcripts and this one are the same conversation — both read the
 * store — so a reply streaming into a node appears here too.
 */
export function ChatPanel() {
  const nodes = useStore((s) => s.nodes)
  const chatTarget = useStore((s) => s.chatTarget)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const send = useStore((s) => s.send)
  const interrupt = useStore((s) => s.interrupt)
  const setPermission = useStore((s) => s.setPermission)

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
  const cwd = resolveCwd(nodes, useStore.getState().edges, active.id)

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
      </div>

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
          roots={searchRootsFor(nodes, useStore.getState().edges, active.id)}
          canvasFiles={canvasFilesFor(nodes)}
          provider={d.provider}
          liveCommands={[...(d.commands ?? []), ...(d.skills ?? [])]}
          onSend={(text) => void send(active.id, text)}
          onInterrupt={() => void interrupt(active.id)}
        />
        <div className="mt-1 flex items-center gap-2 font-mono text-[9.5px] text-fg-faint">
          <span className="truncate">{cwd ? `▸ ${cwd.split('/').filter(Boolean).pop()}` : '▸ no folder'}</span>
          <span className="ml-auto shrink-0">
            {d.usage.outputTokens > 0 && `${d.usage.outputTokens} out`}
            {d.usage.costUsd > 0 && ` · $${d.usage.costUsd.toFixed(3)}`}
          </span>
        </div>
      </div>
    </div>
  )
}
