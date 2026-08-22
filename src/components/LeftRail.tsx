import { useEffect } from 'react'
import {
  Activity,
  Compass,
  Gauge,
  GitFork,
  GitPullRequestArrow,
  Layers,
  Library,
  Radio,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { CanvasesContent } from '@/components/Sidebar'
import { RationaleContent } from '@/components/RationalePanel'
import { useInViewRef, useStore } from '@/lib/store'
import type { PanelKey, RightTab } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The drawers, and the buttons that open them. */
const RAIL = [
  { key: 'canvases', label: 'canvases', Icon: Layers, hint: 'Saved canvases' },
  {
    key: 'rationale',
    label: 'rationale',
    Icon: Compass,
    hint: 'Why the canvas looks the way it does',
  },
] as const satisfies readonly { key: RightTab; label: string; Icon: typeof Layers; hint: string }[]

/**
 * `chat` has no drawer: the conversation lives in the central chatbox and, at
 * full density, inside the agent's own node. A canvas saved while the retired
 * dock was showing it falls back to the canvas list rather than opening an
 * empty drawer under a highlighted button.
 */
/**
 * The canvas-wide readouts. These open no drawer and place no node — each one
 * is a panel floating over the bottom-left of the canvas, so the button is a
 * light switch rather than a way in. Highlighted while its panel is showing,
 * which is the only state a light switch owes you.
 */
const PANELS = [
  { key: 'pulse', label: 'Pulse', Icon: Activity, hint: 'What is going on' },
  { key: 'decisions', label: 'Decisions', Icon: GitFork, hint: 'What is waiting on you' },
  { key: 'shared', label: 'Shared context', Icon: Radio, hint: 'What every agent knows' },
  { key: 'changes', label: 'Changes', Icon: GitPullRequestArrow, hint: 'What has been written' },
  { key: 'usage', label: 'Usage', Icon: Gauge, hint: 'Spend and context' },
  { key: 'skills', label: 'Skills', Icon: Sparkles, hint: 'What the agents can already do' },
  { key: 'personas', label: 'personas', Icon: Library, hint: 'Reusable agents' },
] as const satisfies readonly { key: PanelKey; label: string; Icon: typeof Layers; hint: string }[]

const CONTENT: Partial<Record<RightTab, () => React.ReactElement>> = {
  canvases: CanvasesContent,
  rationale: RationaleContent,
}

/**
 * The one piece of permanent chrome.
 *
 * Everything that used to hold an edge of the window — the canvas list on the
 * left, the persona library on the right — is behind this rail now: the list
 * as a drawer that floats over the canvas and closes on Esc, the library as
 * one of the floating panels. The canvas gets the window; the rail costs it
 * fifty-two pixels and gives back four hundred.
 *
 * The drawer is deliberately not a modal, and neither are the panels. Starting
 * an agent from a persona means seeing where it lands, and that cannot work
 * through a scrim.
 */
export function LeftRail() {
  const inView = useInViewRef()
  const open = useStore((s) => s.libraryOpen)
  const panels = useStore((s) => s.panels)
  const togglePanel = useStore((s) => s.togglePanel)
  const tab = useStore((s) => s.rightTab)
  const setTab = useStore((s) => s.setRightTab)
  const toggle = useStore((s) => s.toggleLibrary)

  /**
   * Esc closes the drawer; ⌘B and ⌘\ toggle it.
   *
   * Both chords carried the old sidebar and stay bound to the nearest thing
   * that survived it, so nothing anyone has in their fingers breaks. Unlike
   * Esc they are not gated on a field having focus — a modified chord is not
   * something you type by accident, and hiding a panel is exactly what you
   * want while the cursor is in one.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      const chord =
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        ['b', '\\'].includes(e.key.toLowerCase())
      if (chord) {
        e.preventDefault()
        return toggle()
      }
      // A dialog or the file editor owns Esc while it is showing; closing a
      // drawer behind one would be a keystroke landing on the wrong surface.
      if (e.key !== 'Escape' || !open) return
      if (st.canvasDialog || st.openFilePath) return
      toggle()
    }
    // The rail is mounted once per open canvas; only the one you are looking
    // at may act on a chord. See `useInView`.
    const guarded = (e: KeyboardEvent) => {
      if (inView.current) onKey(e)
    }
    window.addEventListener('keydown', guarded)
    return () => window.removeEventListener('keydown', guarded)
  }, [inView, open, toggle])

  const Body = CONTENT[tab] ?? CanvasesContent
  const active = RAIL.find((r) => r.key === tab)

  return (
    <>
      <nav className="gt-panel flex w-[52px] shrink-0 flex-col items-center gap-1 rounded-2xl border border-line bg-panel py-2.5">
        {RAIL.map(({ key, Icon, hint }) => {
          const on = open && tab === key
          return (
            <button
              key={key}
              title={hint}
              onClick={() => {
                // Clicking the drawer that is already showing closes it. Any
                // other rail button switches to it rather than toggling, so a
                // click never leaves you with nothing when you asked for
                // something.
                if (on) return toggle()
                setTab(key)
              }}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-lg transition-colors',
                on ? 'bg-surface-2 text-fg' : 'text-fg-subtle hover:bg-surface hover:text-fg-muted',
              )}
            >
              <Icon size={15} />
            </button>
          )
        })}

        <span className="my-1 h-px w-6 bg-line" />

        {PANELS.map(({ key, label, Icon, hint }) => {
          const on = panels[key].open
          return (
            <button
              key={key}
              title={`${hint} — ${on ? 'hide' : 'show'} the ${label} panel`}
              onClick={() => togglePanel(key)}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-lg transition-colors',
                on ? 'bg-surface-2 text-fg' : 'text-fg-subtle hover:bg-surface hover:text-fg-muted',
              )}
            >
              <Icon size={15} />
            </button>
          )
        })}

        <span className="flex-1" />

        <button
          title="Canvas rules  G"
          onClick={() => useStore.getState().setCanvasDialog('rules')}
          className="grid h-9 w-9 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface hover:text-fg-muted"
        >
          <Settings size={15} />
        </button>
      </nav>

      {open && (
        // Typing into a drawer must never trip a canvas shortcut.
        //
        // The drawer floats rather than taking a column, so it cannot inherit
        // the row's `gap-2` the way the rail and the canvas do — it has to be
        // told where the rail ends. Its offset is the row's own inset plus the
        // rail's width plus that same gap, on the same spacing scale, so the
        // ground shows between the rail and the drawer by exactly as much as
        // it does between the rail and the canvas. It sat two pixels *inside*
        // the rail's right edge before, which read as one panel with a seam
        // down it rather than as two.
        <aside
          data-shortcuts="off"
          className="absolute top-0 bottom-0 left-[calc(52px+var(--spacing)*4)] z-20 flex w-[300px] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 backdrop-blur"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-line-soft px-3 py-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-fg-muted uppercase">
              {active?.label ?? tab}
            </span>
            <button
              onClick={toggle}
              title="Close  Esc"
              className="ml-auto rounded p-0.5 text-fg-subtle hover:bg-surface hover:text-fg-muted"
            >
              <X size={12} />
            </button>
          </header>
          <Body />
        </aside>
      )}
    </>
  )
}
