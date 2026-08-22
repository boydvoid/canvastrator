import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { CornerDownLeft, Pencil, Search, Sparkles } from 'lucide-react'
import { FloatingPanel } from '@/components/panels/FloatingPanel'
import { discoverSkills } from '@/lib/bridge'
import { grouped, search as searchRows, shelf, type ShelfSkill } from '@/lib/skills'
import { useStore, type GtNode } from '@/lib/store'
import type { DiscoveredSkill } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The origins, in the order the filter row offers them. */
const FILTERS = ['all', 'canvas', 'user', 'project', 'plugin', 'built-in'] as const
type Filter = (typeof FILTERS)[number]

/**
 * What is installed on this machine, read once per working directory.
 *
 * Skills are files: they change when the user installs a plugin, not while a
 * canvas is running. Re-reading them on render would shell out to the disk for
 * every keystroke in the filter box.
 */
function useDiscovered(cwd: string | null) {
  const [found, setFound] = useState<DiscoveredSkill[]>([])
  useEffect(() => {
    let live = true
    void discoverSkills(cwd)
      .then((s) => live && setFound(s))
      .catch(() => live && setFound([]))
    return () => {
      live = false
    }
  }, [cwd])
  return found
}

function Row({ s, onPick }: { s: ShelfSkill; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      title={
        s.description ||
        (s.origin === 'built-in'
          ? 'Built into the CLI — it reports the name, not a description'
          : s.name)
      }
      className="flex w-full min-w-0 items-center gap-2.5 border-b border-line-soft px-3.5 py-[9px] text-left last:border-b-0 hover:bg-surface-2"
    >
      {/* Loaded is the one fact a row must carry: an installed skill the
          session never loaded cannot be invoked, however good it looks. */}
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: s.loaded ? 'var(--color-live)' : 'var(--color-fg-faint)' }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[11px] text-fg">{s.name}</span>
          {s.origin === 'canvas' && (
            <span className="shrink-0 rounded bg-surface-3 px-1 py-px font-mono text-[8px] text-[var(--color-live)]">
              editable
            </span>
          )}
          {s.kind === 'command' && (
            <span className="shrink-0 font-mono text-[8px] text-fg-faint">/</span>
          )}
        </span>
        {s.description && (
          <span className="line-clamp-2 font-mono text-[9px] leading-snug text-fg-faint">
            {s.description}
          </span>
        )}
      </span>
      {s.origin === 'canvas' ? (
        <Pencil size={12} className="shrink-0 text-fg-faint" />
      ) : (
        <CornerDownLeft size={12} className="shrink-0 text-fg-faint" />
      )}
    </button>
  )
}

/**
 * Everything the agents on this canvas can already do.
 *
 * An agent arrives carrying skills nobody chose: the ones built into its CLI,
 * the ones in the user's home directory, the ones a plugin installed. They
 * were invisible here — the only way to find out a skill existed was to type
 * `/` and recognise a name — so the canvas could not answer the first question
 * anyone asks of a squad, which is what it is capable of.
 *
 * The shelf lists all of it, grouped by where it came from, with a dot for the
 * one thing the source cannot tell you: whether a session on this canvas has
 * actually loaded it. See `skills.ts` for why the built-ins can only ever be
 * names, and `skills.rs` for where the rest is read from.
 *
 * Clicking a row does the only useful thing per kind: a canvas skill opens its
 * node, anything else drops its name into the chat, which is how you invoke
 * one.
 */
export function SkillsPanel() {
  const nodes = useStore((s) => s.nodes)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const addSkill = useStore((s) => s.addSkill)
  const setComposerDraft = useStore((s) => s.setComposerDraft)
  const { fitView, screenToFlowPosition } = useReactFlow()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const input = useRef<HTMLInputElement>(null)

  const sessions = nodes.filter(
    (n): n is GtNode & { type: 'session' } => n.type === 'session',
  )
  // Whichever working directory the agents are in: project skills live there,
  // and a canvas with no agents yet has none to look in.
  const cwd = sessions[0]?.data.cwd ?? null
  const discovered = useDiscovered(cwd)

  const rows = useMemo(() => {
    const canvas = nodes
      .filter((n): n is GtNode & { type: 'skill' } => n.type === 'skill')
      .map((n) => ({ id: n.id, name: n.data.name, description: n.data.description }))
    const loaded = sessions.map((n) => ({
      skills: n.data.skills ?? [],
      commands: n.data.commands ?? [],
    }))
    return shelf(discovered, canvas, loaded)
  }, [discovered, nodes, sessions])

  const shown = useMemo(() => {
    const byFilter = filter === 'all' ? rows : rows.filter((r) => r.origin === filter)
    return searchRows(byFilter, query)
  }, [rows, filter, query])

  const pick = (s: ShelfSkill) => {
    if (s.nodeId) {
      // A canvas skill is a node you edit, so go to it rather than naming it
      // at an agent that already has it.
      void fitView({ nodes: [{ id: s.nodeId }], duration: 420, maxZoom: 1, padding: 0.4 })
      return
    }
    // Everything else is invoked. Dropping the name in the composer beats
    // sending it: a skill nearly always needs an argument after it.
    setComposerDraft(`/${s.name} `)
    if (!useStore.getState().chatTarget && sessions[0]) setChatTarget(sessions[0].id)
  }

  const write = () => {
    const at = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const id = addSkill(at)
    void fitView({ nodes: [{ id }], duration: 420, maxZoom: 1, padding: 0.4 })
  }

  const groups = grouped(shown)

  return (
    <FloatingPanel
      panel="skills"
      title="SKILLS"
      Icon={Sparkles}
      badge={
        <span className="font-mono text-[9.5px] text-fg-subtle tabular-nums">
          {rows.length} available
        </span>
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3.5 py-[9px]">
        <Search size={11} className="shrink-0 text-fg-faint" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (query ? setQuery('') : input.current?.blur())}
          placeholder="filter skills…"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[10.5px] text-fg outline-none placeholder:text-fg-faint"
        />
        {query && <span className="shrink-0 font-mono text-[9px] text-fg-faint">esc</span>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3.5 py-[9px]">
        {FILTERS.map((f) => {
          const on = filter === f
          // A filter with nothing behind it is a dead end; only offer the
          // origins this machine actually has.
          if (f !== 'all' && !rows.some((r) => r.origin === f)) return null
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-2 py-[3px] font-mono text-[9px] transition-colors',
                on
                  ? 'bg-surface-3 text-fg'
                  : 'border border-line text-fg-subtle hover:text-fg-muted',
              )}
            >
              {f}
            </button>
          )
        })}
      </div>

      <div className="max-h-72 overflow-y-auto overscroll-contain">
        {shown.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[11px] leading-snug text-fg-faint">
            {rows.length === 0
              ? 'No skills found yet. Spawn an agent and the ones its CLI carries appear here.'
              : 'Nothing matches that.'}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="flex items-center gap-2 bg-panel px-3.5 pt-2 pb-[7px]">
                <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint uppercase">
                  {g.label}
                </span>
                <span className="font-mono text-[9px] text-fg-faint">{g.rows.length}</span>
              </div>
              {g.rows.map((s) => (
                <Row key={s.id} s={s} onPick={() => pick(s)} />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3.5 py-2">
        <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-live)]" />
        <span className="truncate font-mono text-[9px] text-fg-faint">
          green = an agent has it loaded
        </span>
        <button
          onClick={write}
          className="ml-auto shrink-0 font-mono text-[9px] text-fg-subtle hover:text-fg-muted"
        >
          write one
        </button>
      </div>
    </FloatingPanel>
  )
}
