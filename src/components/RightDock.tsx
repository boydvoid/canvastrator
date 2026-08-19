import { ChevronRight, Library, MessagesSquare } from 'lucide-react'
import { ChatPanel } from '@/components/ChatPanel'
import { LibraryContent } from '@/components/LibraryPanel'
import { CHAT_PANEL_ENABLED } from '@/lib/flags'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

const TAB = {
  chat: { label: 'chat', Icon: MessagesSquare },
  personas: { label: 'personas', Icon: Library },
} as const

/**
 * The right dock. Chat and the persona library share one edge as tabs rather
 * than competing for it — two panels docked right would leave the canvas a
 * slot in the middle.
 *
 * With `CHAT_PANEL_ENABLED` off the chat tab is gone and this is the persona
 * library: the conversation lives in the central chatbox instead. A dock with
 * one tab still keeps its header, so putting the panel back is one constant.
 */
export function RightDock() {
  const open = useStore((s) => s.libraryOpen)
  const toggle = useStore((s) => s.toggleLibrary)
  const stored = useStore((s) => s.rightTab)
  const setTab = useStore((s) => s.setRightTab)
  // A canvas saved while the panel was showing chat still carries that tab.
  const tab = CHAT_PANEL_ENABLED ? stored : 'personas'

  const tabs = (CHAT_PANEL_ENABLED ? (['chat', 'personas'] as const) : (['personas'] as const)).map(
    (key) => [key, TAB[key]] as const,
  )

  if (!open) {
    return (
      <div className="flex h-full shrink-0 flex-col justify-center gap-1">
        {tabs.map(([key, { label, Icon }]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="rounded-xl border border-line bg-panel px-1.5 py-3 text-fg-muted hover:text-fg"
            title={label}
          >
            <Icon size={12} />
          </button>
        ))}
      </div>
    )
  }

  return (
    // Typing to an agent must never trip a canvas shortcut.
    <aside
      data-shortcuts="off"
      className="flex h-full w-[26rem] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-line-soft px-2 py-1.5">
        {tabs.map(([key, { label, Icon }]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] transition-colors',
              tab === key ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon size={11} />
            {label}
          </button>
        ))}
        <button
          onClick={toggle}
          className="ml-auto rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg-muted"
          title="Hide panel"
        >
          <ChevronRight size={13} />
        </button>
      </header>

      {tab === 'chat' ? <ChatPanel /> : <LibraryContent />}
    </aside>
  )
}
