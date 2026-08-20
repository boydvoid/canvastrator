import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { PanelKey } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The chrome every floating panel wears.
 *
 * One header, always drawn, carrying the panel's name and the two things you
 * can do to it: fold it to that header alone, or put it away. Minimizing is
 * deliberately not the same gesture as closing — a stack of three panels is
 * only usable if you can keep one in the corner as a title while you read
 * another, and a panel you closed is one you have to go and find again.
 *
 * The surface matches the rail's drawer and the chatbox: same border, same
 * radius, same translucent panel fill. These sit over the canvas, so they read
 * as chrome rather than as something placed on it.
 */
export function FloatingPanel({
  panel,
  title,
  Icon,
  badge,
  children,
}: {
  panel: PanelKey
  title: string
  Icon: typeof X
  /** Whatever the header should say when the body is folded away. */
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const state = useStore((s) => s.panels[panel])
  const setMinimized = useStore((s) => s.setPanelMinimized)
  const toggle = useStore((s) => s.togglePanel)

  if (!state.open) return null

  const Chevron = state.minimized ? ChevronUp : ChevronDown

  return (
    // Typing into a panel must never trip a canvas shortcut — the persona
    // editor is nothing but fields.
    <section
      data-shortcuts="off"
      className="pointer-events-auto flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur"
    >
      <header className="flex shrink-0 items-center gap-2 bg-surface-2/70 px-3 py-1.5">
        <Icon size={11} className="shrink-0 text-fg-muted" />
        <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">{title}</span>
        {badge && <span className="ml-auto flex min-w-0 items-center">{badge}</span>}
        <span className={cn('flex shrink-0 items-center gap-0.5', !badge && 'ml-auto')}>
          <button
            onClick={() => setMinimized(panel, !state.minimized)}
            title={state.minimized ? 'Expand' : 'Minimize'}
            className="rounded p-0.5 text-fg-subtle hover:bg-surface hover:text-fg-muted"
          >
            <Chevron size={12} />
          </button>
          <button
            onClick={() => toggle(panel)}
            title="Close"
            className="rounded p-0.5 text-fg-subtle hover:bg-surface hover:text-fg-muted"
          >
            <X size={12} />
          </button>
        </span>
      </header>

      {!state.minimized && <div className="flex flex-col">{children}</div>}
    </section>
  )
}
