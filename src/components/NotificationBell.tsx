import { Bell } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { timeAgo } from '@/lib/ago'
import { isBellKind } from '@/lib/pulse'
import { useStore } from '@/lib/store'
import { PROVIDER_ACCENT } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * What happened while you were looking somewhere else.
 *
 * This replaces the summary node that used to land on the canvas beside every
 * agent when a turn finished. Those were accurate and nobody read them: they
 * competed with the agents for space, and a canvas left running for an hour
 * spent most of its area on history. A feed costs no canvas and is still there
 * when you come back.
 */
export function NotificationBell() {
  // The feed the bell draws from is now the whole Pulse log — prompts you
  // typed, agents you spawned, files that were written. The bell keeps its
  // original meaning: things that happened while you were looking elsewhere.
  // The rest of the log is the Pulse module's to show.
  const notifications = useStore(
    useShallow((s) => s.notifications.filter((n) => isBellKind(n.kind))),
  )
  const markRead = useStore((s) => s.markNotificationsRead)
  const clear = useStore((s) => s.clearNotifications)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const setRightTab = useStore((s) => s.setRightTab)

  const unread = notifications.filter((n) => !n.read).length
  // A question is someone waiting on you, which is worth more than a count.
  const asking = notifications.some((n) => !n.read && n.kind === 'question')

  const open = (sessionNodeId: string) => {
    setChatTarget(sessionNodeId)
    setRightTab('chat')
    markRead()
  }

  return (
    <DropdownMenu onOpenChange={(o) => !o && unread > 0 && markRead()}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative rounded px-1 py-0.5 text-fg-muted hover:bg-surface hover:text-fg"
          title={unread ? `${unread} unread` : 'Nothing new'}
        >
          <Bell size={13} />
          {unread > 0 && (
            <span
              className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full"
              style={{
                background: asking ? 'var(--color-claude)' : 'var(--color-fg-muted)',
              }}
            />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-y-auto p-0">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line-soft bg-panel px-2 py-1.5">
          <span className="font-mono text-[10.5px] tracking-wide text-fg-muted uppercase">
            activity
          </span>
          {notifications.length > 0 && (
            <button
              onClick={clear}
              className="ml-auto font-mono text-[10px] text-fg-faint hover:text-fg"
            >
              clear
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center font-mono text-[11px] text-fg-faint">
            Nothing yet. Finished turns show up here.
          </p>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n.sessionNodeId)}
              className={cn(
                'block w-full border-b border-line-soft px-2.5 py-2 text-left last:border-b-0 hover:bg-surface',
                n.read && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: PROVIDER_ACCENT[n.provider] }}
                />
                <span className="truncate font-mono text-[11px] text-fg">{n.sessionName}</span>
                {n.kind === 'question' && (
                  <span
                    className="shrink-0 rounded px-1 py-px font-mono text-[9.5px]"
                    style={{
                      background: 'color-mix(in oklch, var(--color-claude) 20%, transparent)',
                      color: 'var(--color-claude)',
                    }}
                  >
                    asked you
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-fg-faint">
                  {timeAgo(n.ts)}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-fg-subtle">
                {n.headline}
              </p>
              {n.tools.length > 0 && (
                <p className="mt-0.5 truncate font-mono text-[9.5px] text-fg-faint">
                  {n.tools.join(' · ')}
                  {n.toolCount > n.tools.length && ` +${n.toolCount - n.tools.length}`}
                </p>
              )}
            </button>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
