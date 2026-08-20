import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ArrowDown, ChevronDown, ChevronUp, Cpu, Crosshair, Hexagon } from 'lucide-react'
import { Composer } from '@/components/Composer'
import { TerminalView } from '@/components/TerminalView'
import { RunningStatus } from '@/components/RunningStatus'
import { Bubble, EffortMenu, FolderMenu, ModelMenu } from '@/components/ChatPanel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  canvasFilesFor,
  folderRootsFor,
  resolveCwd,
  searchRootsFor,
  useStore,
  type GtNode,
} from '@/lib/store'
import {
  MODEL_OPTIONS,
  MODEL_TIERS,
  modelLabel,
  PERMISSION_LABEL,
  PERMISSIONS,
  PROVIDER_ACCENT,
  PROVIDER_LABEL,
  type ModelTier,
  type OrchestraPrefs,
  type Provider,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const PROVIDERS: Provider[] = ['claude', 'codex', 'opencode']

/** What each tier is called in the menu — shorter than the brief's wording. */
const TIER_LABEL: Record<ModelTier, string> = {
  heavy: 'hard reasoning',
  mid: 'implementation',
  light: 'mechanical passes',
}

const prefCount = (o: OrchestraPrefs) =>
  [o.provider, ...MODEL_TIERS.map((t) => o[t])].filter(Boolean).length

/**
 * What the orchestrator should reach for when it invents a persona.
 *
 * Canvas-wide, not per session: the setting is about the agents that do not
 * exist yet, so it is shown wherever the chatbox is pointed rather than only
 * on the orchestrator. The model lists come from the preferred provider, or
 * from whoever you are talking to while no provider is preferred — picking a
 * codex model for a canvas that spawns claude agents is not a choice worth
 * offering.
 */
function OrchestraMenu({ fallback }: { fallback: Provider }) {
  const orchestra = useStore((s) => s.orchestra)
  const setOrchestra = useStore((s) => s.setOrchestra)
  const provider = orchestra.provider ?? fallback
  const set = prefCount(orchestra)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-surface',
            set ? 'text-fg-muted' : 'text-fg-subtle hover:text-fg-muted',
          )}
          title="Which models this canvas's orchestrator should reach for"
        >
          <Cpu size={10} />
          orchestra{set > 0 && ` ${set}`} ▾
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Models this canvas prefers</DropdownMenuLabel>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="justify-between">
            <span>provider</span>
            <span className="font-mono text-[10px] text-fg-faint">
              {orchestra.provider ? PROVIDER_LABEL[orchestra.provider] : 'any'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => setOrchestra({ provider: null })}>
              any — let it choose
            </DropdownMenuItem>
            {PROVIDERS.map((p) => (
              <DropdownMenuItem key={p} onSelect={() => setOrchestra({ provider: p })}>
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: PROVIDER_ACCENT[p] }}
                />
                {PROVIDER_LABEL[p]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {MODEL_TIERS.map((tier) => (
          <DropdownMenuSub key={tier}>
            <DropdownMenuSubTrigger className="justify-between">
              <span>{TIER_LABEL[tier]}</span>
              <span className="max-w-28 truncate font-mono text-[10px] text-fg-faint">
                {orchestra[tier] ? modelLabel(provider, orchestra[tier]!) : 'no preference'}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              <DropdownMenuItem onSelect={() => setOrchestra({ [tier]: null })}>
                no preference
              </DropdownMenuItem>
              {MODEL_OPTIONS[provider].map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  title={m.note ?? m.id}
                  onSelect={() => setOrchestra({ [tier]: m.id })}
                  className="justify-between"
                >
                  {m.label}
                  {m.tier && (
                    <span className="font-mono text-[9.5px] text-fg-faint">{m.tier}</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}

        {set > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                setOrchestra({ provider: null, heavy: null, mid: null, light: null })
              }
            >
              Clear preferences
            </DropdownMenuItem>
          </>
        )}
        <p className="px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-fg-faint">
          A default for personas the orchestrator invents, not a rule — it may
          depart from one when the work needs a different model, and says so
          when it does.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The chatbox, in the middle of the canvas rather than docked beside it.
 *
 * The dock put the conversation as far from the graph as the window allows,
 * on the edge you are least likely to be looking at — and the graph is a
 * picture of what the conversation is doing. So it floats over the flow,
 * centred, and folds down to a single composer when the transcript is in the
 * way of the nodes underneath.
 *
 * It reads the same store the node transcripts do, so a reply streaming into a
 * node appears here at the same time.
 */
/**
 * The floating box itself. Shared, because a terminal and a conversation are
 * the same window in the same place — only the contents differ, and two copies
 * of this string would drift the moment one of them was adjusted.
 */
/**
 * Bottom right, and small.
 *
 * Centred and 46rem wide, this sat squarely over the middle of the canvas —
 * the part you are actually arranging — and a canvas you have to talk *around*
 * is one the box is fighting. The corner is the one region no layout puts
 * anything in: the flow reads left to right and top to bottom, agents fan
 * downward from their orchestrator, and the modules sit where they are placed.
 * The other bottom corner already belongs to the zoom controls.
 *
 * Capped in height as well as width, and anchored at the bottom so it grows
 * *upward* as the transcript fills it. Without a ceiling it grew past the top
 * of the canvas and clipped, and everything above that edge was unreachable —
 * not scrolled to, not clickable.
 */
const BOX =
  'pointer-events-auto absolute right-4 bottom-4 z-20 flex max-h-[min(34rem,calc(100%-2rem))] w-[min(26rem,calc(100%-2rem))] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur'

export function CentralChat() {
  const nodes = useStore((s) => s.nodes)
  // Subscribed, not read once: which folder is primary is an edge *type*, so
  // promoting one changes no node and the footer would keep naming the old
  // working directory until something else re-rendered it.
  const edges = useStore((s) => s.edges)
  const chatTarget = useStore((s) => s.chatTarget)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const send = useStore((s) => s.send)
  const { fitView } = useReactFlow()
  const interrupt = useStore((s) => s.interrupt)
  const setPermission = useStore((s) => s.setPermission)

  const sessions = useMemo(
    () => nodes.filter((n): n is GtNode & { type: 'session' } => n.type === 'session'),
    [nodes],
  )

  // A terminal node clicked on the canvas takes the box over: it is a screen
  // you type into, which is what this space is for, and it is far too small to
  // work in on the canvas itself. The conversation is one click away — the
  // agent picker in the header is still there.
  const terminal = nodes.find(
    (n): n is GtNode & { type: 'terminal' } => n.type === 'terminal' && n.id === chatTarget,
  )

  // Default to the orchestrator: it's the one you talk to most, and a stale
  // target (a killed session) must not leave the box pointing at nothing.
  const active =
    sessions.find((n) => n.id === chatTarget) ??
    sessions.find((n) => n.data.role === 'orchestrator') ??
    sessions[0]

  // Collapsed by default: this is configuration, and the conversation is why
  // the box is on screen at all.
  // The transcript folds away, not the box — a chatbox you can't type into is
  // a chatbox that isn't there.
  const [open, setOpen] = useState(true)

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
  }, [active?.data.messages, open])

  // Switching agents starts you at the end of that conversation.
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
      stick.current = true
      setAtBottom(true)
    }
  }, [active?.id])

  // A terminal takes the whole box, header included: nothing in the agent
  // header applies to a shell, and most of it — model, effort, permission —
  // would be describing something that is not there.
  if (terminal) {
    return (
      <div data-shortcuts="off" className={BOX}>
        <TerminalView node={terminal} />
      </div>
    )
  }

  if (!active) return null

  const d = active.data
  const accent = PROVIDER_ACCENT[d.provider]
  const busy = d.state === 'thinking' || d.state === 'streaming'
  const cwd = resolveCwd(nodes, edges, active.id)
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
    // Typing to an agent must never trip a canvas shortcut.
    <div data-shortcuts="off" className={BOX}>
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
                    fill={
                      n.data.role === 'orchestrator'
                        ? PROVIDER_ACCENT[n.data.provider]
                        : 'transparent'
                    }
                  />
                  {n.data.name}
                </span>
                <span className="font-mono text-[9.5px] text-fg-faint">{n.data.state}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <OrchestraMenu fallback={d.provider} />
          <button
            onClick={() =>
              setPermission(active.id, PERMISSIONS[(PERMISSIONS.indexOf(d.permission) + 1) % 3])
            }
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]',
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
          {/* The settings used to unfold inside this box. They live beside
              the agent's node now, so this goes there instead of opening a
              second copy of them here — see `Inspector`. */}
          <button
            onClick={() => {
              useStore.getState().focusNode(active.id)
              void fitView({ nodes: [{ id: active.id }], duration: 420, maxZoom: 1, padding: 0.6 })
            }}
            title="Show this agent on the canvas, with its settings"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg-muted"
          >
            <Crosshair size={12} />
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            title={open ? 'Fold the transcript away' : 'Show the transcript'}
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg-muted"
          >
            {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>
      </div>

      {/* What the next turn runs as, on a line of its own.
          These share the header at a wider box, but at this width the agent's
          name, three menus and the controls above cannot all keep their labels
          — and the first thing to give was the name, which is the one thing
          the row exists to say. They are per-turn settings and belong with the
          composer; the same values are also on the node's inspector, which is
          where you change them for the agent rather than for this message. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line-soft px-2 py-1">
        <ModelMenu node={active} />
        <EffortMenu node={active} />
        <FolderMenu node={active} />
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
      {open && (
        // The transcript is what gives when the box runs out of room. Every
        // other section is `shrink-0` on purpose — a half-drawn composer or a
        // clipped plan step is useless, while a shorter transcript is merely a
        // shorter transcript, and it scrolls.
        <div className="relative flex min-h-0 flex-col">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="max-h-[24vh] min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
          >
            {d.messages.length === 0 && (
              <p className="py-6 text-center font-mono text-[11px] text-fg-faint">
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
              className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-panel px-2 py-1 font-mono text-[10px] text-fg-muted shadow-lg hover:bg-surface-2"
            >
              <ArrowDown size={10} /> latest
            </button>
          )}
        </div>
      )}

      {/* composer */}
      <div className="shrink-0 border-t border-line-soft p-2">
        <Composer
          // Keyed to the target: a pasted image lives under *that* session's
          // temp dir, and carrying it across a switch would send session A's
          // screenshot to session B, pointing at a directory A takes with it
          // when it's deleted. The remount drops the draft too, which is the
          // same bargain and the less surprising one.
          key={d.sessionId}
          // Just the name. The box is 26rem wide now and the full hint list
          // wrapped to two lines, which made the field look like it already
          // had something in it — and a placeholder that reads as content is
          // worse than one that says less. The hints are in the footer.
          placeholder={busy ? 'running…' : `Message ${d.name}…`}
          busy={busy}
          sessionId={d.sessionId}
          cwd={cwd}
          roots={searchRootsFor(nodes, edges, active.id)}
          canvasFiles={canvasFilesFor(nodes)}
          provider={d.provider}
          liveCommands={[...(d.commands ?? []), ...(d.skills ?? [])]}
          onSend={(text, images) => void send(active.id, text, images)}
          onInterrupt={() => void interrupt(active.id)}
        />
        <div className="mt-1 flex items-center gap-2 font-mono text-[9.5px] text-fg-faint">
          <span className="truncate">
            {cwd ? `▸ ${cwd.split('/').filter(Boolean).pop()}` : '▸ no folder'}
          </span>
          {extraFolders > 0 && <span className="shrink-0">+{extraFolders}</span>}
          {/* `/` and `@` reveal themselves the moment you type them, and ↵ to
              send needs no telling. Shift-↵ for a newline is the one that has
              to be said, because the alternative is losing a half-written
              paragraph to find out. */}
          <span className="shrink-0">⇧↵ newline</span>
          <span className="ml-auto shrink-0">
            {d.usage.outputTokens > 0 && `${d.usage.outputTokens} out`}
            {d.usage.costUsd > 0 && ` · $${d.usage.costUsd.toFixed(3)}`}
          </span>
        </div>
      </div>
    </div>
  )
}
