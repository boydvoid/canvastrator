import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import {
  Activity,
  Bot,
  Crosshair,
  FilePlus2,
  Gauge,
  GitFork,
  GitPullRequestArrow,
  LayoutGrid,
  Library,
  Radio,
  Save,
  Search,
  Settings,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { screenLayer } from '@/components/ScreenLayer'
import { newCanvas, saveCanvas } from '@/lib/canvas'
import { useStore } from '@/lib/store'
import { PROVIDER_LABEL, type Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

type Item = {
  id: string
  group: 'SPAWN' | 'ACT' | 'GO TO'
  title: string
  detail: string
  Icon: typeof Bot
  run: () => void
}

/**
 * Rank by where the query matched, not just whether it did.
 *
 * A prefix match on the title is what someone typing three letters means; a
 * match buried in the description is a coincidence they will scroll past. The
 * middle case — a word inside the title — sits between the two.
 */
function score(item: Item, q: string): number {
  if (!q) return 0
  const title = item.title.toLowerCase()
  if (title.startsWith(q)) return 0
  if (title.includes(q)) return 1
  if (item.detail.toLowerCase().includes(q)) return 2
  return -1
}

/**
 * One way in to everything.
 *
 * The panels this app used to keep on screen were each a permanent answer to a
 * question asked a few times an hour. ⌘K is the impermanent answer: spawn an
 * agent from the library, run the handful of things that act on the whole
 * canvas, or jump to any node by name — then it is gone again and the canvas
 * has the window back.
 *
 * "Go to" is the half that could not exist before. On a canvas of thirty nodes
 * the only way to reach one was to find it by eye at a zoom where you could
 * read its name, which is the search problem solved by panning.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const nodes = useStore((s) => s.nodes)
  const library = useStore((s) => s.library)
  const providers = useStore((s) => s.providers)
  const canvasName = useStore((s) => s.canvasName)
  const { fitView, screenToFlowPosition } = useReactFlow()

  /** The middle of the viewport — where a thing you asked for by name lands. */
  const centre = () =>
    screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  const items = useMemo<Item[]>(() => {
    const st = useStore.getState()
    const out: Item[] = []

    for (const persona of library) {
      out.push({
        id: `persona:${persona.name}`,
        group: 'SPAWN',
        title: persona.name,
        detail: `persona · ${persona.provider}${persona.model ? ` · ${persona.model}` : ''}`,
        Icon: Bot,
        run: () => st.addSessionFromPersona(persona, centre()),
      })
    }
    for (const p of providers) {
      if (!p.available) continue
      out.push({
        id: `provider:${p.provider}`,
        group: 'SPAWN',
        title: `${PROVIDER_LABEL[p.provider]} agent`,
        detail: 'a blank agent on this provider',
        Icon: Bot,
        run: () => st.addSession(p.provider as Provider, centre()),
      })
    }

    out.push(
      {
        id: 'act:pulse',
        group: 'ACT',
        title: st.panels.pulse.open ? 'Hide the Pulse panel' : 'Show the Pulse panel',
        detail: 'one line per thing that happened',
        Icon: Activity,
        run: () => st.togglePanel('pulse'),
      },
      {
        id: 'act:decisions',
        group: 'ACT',
        title: st.panels.decisions.open ? 'Hide the Decisions panel' : 'Show the Decisions panel',
        detail: 'the question an agent is waiting on',
        Icon: GitFork,
        run: () => st.togglePanel('decisions'),
      },
      {
        id: 'act:shared',
        group: 'ACT',
        title: st.panels.shared.open ? 'Hide the shared context' : 'Show the shared context',
        detail: 'what every agent on this canvas knows',
        Icon: Radio,
        run: () => st.togglePanel('shared'),
      },
      {
        id: 'act:changes',
        group: 'ACT',
        title: st.panels.changes.open ? 'Hide the Changes panel' : 'Show the Changes panel',
        detail: 'what was written, and how much of it',
        Icon: GitPullRequestArrow,
        run: () => st.togglePanel('changes'),
      },
      {
        id: 'act:usage',
        group: 'ACT',
        title: st.panels.usage.open ? 'Hide the Usage panel' : 'Show the Usage panel',
        detail: 'spend, burn rate and every context window',
        Icon: Gauge,
        run: () => st.togglePanel('usage'),
      },
      {
        id: 'act:skills',
        group: 'ACT',
        title: st.panels.skills.open ? 'Hide the Skills panel' : 'Show the Skills panel',
        detail: 'every skill the agents already carry',
        Icon: Sparkles,
        run: () => st.togglePanel('skills'),
      },
      {
        id: 'act:personas',
        group: 'ACT',
        title: st.panels.personas.open ? 'Hide the personas panel' : 'Show the personas panel',
        detail: 'the reusable agents every orchestrator can spawn',
        Icon: Library,
        run: () => st.togglePanel('personas'),
      },
      {
        id: 'act:changes',
        group: 'ACT',
        title: 'Changes module',
        detail: 'every file the agents wrote, and how much changed in it',
        Icon: GitPullRequestArrow,
        run: () => st.addChanges(centre()),
      },
      {
        id: 'act:tidy',
        group: 'ACT',
        title: 'Tidy everything',
        detail: 'lay the whole canvas out, including nodes you placed',
        Icon: LayoutGrid,
        run: () => {
          st.tidy(true)
          setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 60)
        },
      },
      {
        id: 'act:save',
        group: 'ACT',
        title: 'Save canvas',
        detail: canvasName,
        Icon: Save,
        run: () => void saveCanvas(),
      },
      {
        id: 'act:new',
        group: 'ACT',
        title: 'New canvas',
        detail: 'start an empty one — this canvas stays on disk',
        Icon: FilePlus2,
        run: () => void newCanvas(),
      },
      {
        id: 'act:rules',
        group: 'ACT',
        title: 'Canvas rules',
        detail: 'the brief every agent on this canvas is given',
        Icon: Settings,
        run: () => st.setCanvasDialog('rules'),
      },
      {
        id: 'act:planning',
        group: 'ACT',
        title: st.planning ? 'Turn planning off' : 'Turn planning on',
        detail: st.planning
          ? 'let the orchestrator spawn as soon as it decides to'
          : 'make the orchestrator propose the work before it runs',
        Icon: Wand2,
        run: () => st.togglePlanning(),
      },
    )

    for (const n of nodes) {
      // A folder has no name of its own — the directory it points at is its
      // name, and its last segment is what the canvas already calls it.
      const name =
        n.type === 'session' || n.type === 'skill' || n.type === 'terminal'
          ? n.data.name
          : n.type === 'folder' || n.type === 'file'
            ? n.data.path.split('/').filter(Boolean).pop()
            : n.type === 'mcp'
              ? n.data.name
              : n.type
      if (!name) continue
      out.push({
        id: `go:${n.id}`,
        group: 'GO TO',
        title: name,
        detail:
          n.type === 'session'
            ? `agent · ${n.data.state}`
            : n.type === 'file' || n.type === 'folder'
              ? `${n.type} · ${n.data.path}`
              : n.type,
        Icon: Crosshair,
        run: () => {
          if (n.type === 'session') st.setChatTarget(n.id)
          void fitView({ nodes: [{ id: n.id }], duration: 420, maxZoom: 1, padding: 0.4 })
        },
      })
    }

    return out
    // `centre`, `fitView` and the store are read at run time; rebuilding the
    // list when they change would rebuild it on every viewport move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, providers, nodes, canvasName])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .map((item) => ({ item, rank: score(item, q) }))
      .filter((m) => m.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 40)
      .map((m) => m.item)
  }, [items, query])

  // A query that narrows the list must not leave the cursor past the end of it.
  useEffect(() => setCursor(0), [query])

  // Esc closes it from anywhere, not just from the field. The input handles the
  // key too — it has to, to stop it reaching the canvas — but focus can leave
  // the field by a click on the list, and a palette that then refuses to close
  // has trapped the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    listRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const run = (item: Item | undefined) => {
    if (!item) return
    item.run()
    onClose()
  }

  let group = ''

  return screenLayer(
    <div
      data-shortcuts="off"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-canvas/40 backdrop-blur-[1px]" onPointerDown={onClose} />

      <div className="relative flex max-h-[62vh] w-[560px] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_14px_40px_-8px_rgba(0,0,0,0.7)]">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <Search size={15} className="shrink-0 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            spellCheck={false}
            placeholder="Spawn, act, or jump to anything…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') return onClose()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(matches.length - 1, c + 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                run(matches[cursor])
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-fg-strong outline-none placeholder:text-fg-faint"
          />
          <span className="shrink-0 font-mono text-[10px] text-fg-faint">{canvasName}</span>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {matches.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px] text-fg-faint">
              Nothing matches “{query}”.
            </p>
          )}
          {matches.map((item, i) => {
            const head = item.group !== group ? ((group = item.group), item.group) : null
            const on = i === cursor
            return (
              <div key={item.id}>
                {head && (
                  <div className="px-4 pt-2.5 pb-1 font-mono text-[9px] tracking-[0.13em] text-fg-faint">
                    {head}
                  </div>
                )}
                <button
                  data-on={on}
                  onPointerEnter={() => setCursor(i)}
                  onClick={() => run(item)}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left',
                    on && 'bg-surface-2',
                  )}
                >
                  <item.Icon
                    size={13}
                    className={cn('shrink-0', on ? 'text-[var(--color-claude)]' : 'text-fg-subtle')}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={cn('truncate text-[13px]', on ? 'text-fg-strong' : 'text-fg')}
                    >
                      {item.title}
                    </span>
                    <span className="truncate font-mono text-[9.5px] text-fg-faint">
                      {item.detail}
                    </span>
                  </span>
                  {on && (
                    <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-fg-muted">
                      ⏎
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center gap-4 border-t border-line bg-surface px-4 py-2 font-mono text-[9px] text-fg-faint">
          <span>↑↓ move</span>
          <span>⏎ run</span>
          <span>esc</span>
          <span className="ml-auto">{matches.length} of {items.length}</span>
        </div>
      </div>
    </div>,
  )
}
