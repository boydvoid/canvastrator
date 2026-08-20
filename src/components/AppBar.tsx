import { getCurrentWindow } from '@tauri-apps/api/window'
import { PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CanvasStatus } from '@/components/CanvasBar'
import { ContextMeter } from '@/components/ContextMeter'
import { NotificationBell } from '@/components/NotificationBell'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The window's own title bar, replaced.
 *
 * The native bar is hidden but the traffic lights stay, so everything here is
 * inset past them. The bar itself is a drag region — with no system title bar,
 * the window would otherwise be unmovable except by its edges. Anything
 * interactive has to opt out of that, or clicking a button drags the window.
 */
export function AppBar({
  collapsed,
  onToggleSidebar,
  onTidy,
}: {
  collapsed: boolean
  onToggleSidebar: () => void
  onTidy: () => void
}) {
  const nodes = useStore((s) => s.nodes)
  const bus = useStore((s) => s.bus)
  const autoTidy = useStore((s) => s.autoTidy)
  const planning = useStore((s) => s.planning)
  const togglePlanning = useStore((s) => s.togglePlanning)
  const toggleAutoTidy = useStore((s) => s.toggleAutoTidy)

  const folders = nodes.filter((n) => n.type === 'folder').length
  // A canvas can sit stalled on a question nobody noticed. Surface it where
  // the eye already goes for status, and make clicking it go there.
  const waiting = nodes.filter(
    (n) => n.type === 'session' && n.data.awaitingUser && n.data.state === 'idle',
  )
  const working = nodes.filter(
    (n) =>
      n.type === 'session' && (n.data.state === 'thinking' || n.data.state === 'streaming'),
  )
  const sessions = nodes.filter((n) => n.type === 'session').length
  const totalCost = nodes.reduce(
    (acc, n) => acc + (n.type === 'session' ? n.data.usage.costUsd : 0),
    0,
  )

  return (
    <header
      data-tauri-drag-region
      // Double-click zooms, the way a real title bar does.
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button,input,a')) return
        void getCurrentWindow().toggleMaximize().catch(() => {})
      }}
      // Left padding clears the traffic lights; the bar is the drag handle.
      //
      // Every non-interactive child carries the attribute too: the region is
      // matched against the element actually under the pointer, so a bare
      // <span> on top of the header swallows the drag.
      className="flex h-11 shrink-0 items-center gap-2.5 pr-3 pl-[86px] select-none"
    >
      {collapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Show sidebar  ⌘B"
          onClick={onToggleSidebar}
        >
          <PanelLeftOpen size={13} />
        </Button>
      )}

      <span className="font-mono text-[12.5px] tracking-tight text-fg" data-tauri-drag-region>
        canvas<span className="text-fg-muted">trator</span>
      </span>

      <span data-tauri-drag-region className="flex items-center">
        <CanvasStatus />
      </span>

      <span className="font-mono text-[11px] text-fg-muted" data-tauri-drag-region>
        {folders === 0 ? 'no folder yet' : `${folders} folder${folders > 1 ? 's' : ''}`}
      </span>

      {working.length > 0 && (
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
          <span className="gt-caret">●</span>
          {working.length === 1
            ? `${working[0].type === 'session' ? working[0].data.name : ''} working`
            : `${working.length} working`}
        </span>
      )}

      {waiting.length > 0 && (
        <button
          onClick={() => {
            const first = waiting[0]
            useStore.getState().setChatTarget(first.id)
            useStore.getState().setRightTab('chat')
          }}
          className="rounded px-1.5 py-0.5 font-mono text-[11px]"
          style={{
            background: 'color-mix(in oklch, var(--color-claude) 18%, transparent)',
            color: 'var(--color-claude)',
          }}
          title="An agent ended its turn with a question. Click to open it."
        >
          {waiting.length} waiting on you
        </button>
      )}

      <div data-tauri-drag-region className="ml-auto flex items-center gap-2.5">
        <button
          onClick={onTidy}
          className="rounded px-1.5 py-0.5 font-mono text-[11px] text-fg-muted hover:bg-surface hover:text-fg"
          title="Tidy the canvas  ⇧⌘L"
        >
          tidy
        </button>
        <button
          onClick={togglePlanning}
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-[11px] hover:bg-surface hover:text-fg',
            planning ? 'text-fg' : 'text-fg-muted',
          )}
          title={
            planning
              ? 'Planning is on: the orchestrator proposes the work and nothing runs until you approve it. Click to let it run on its own.'
              : 'Planning is off: the orchestrator spawns agents as soon as it decides to. Click to make it propose first.'
          }
        >
          {planning ? 'planning' : 'auto-run'}
        </button>
        <button
          onClick={toggleAutoTidy}
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-[11px] hover:bg-surface hover:text-fg',
            autoTidy ? 'text-fg' : 'text-fg-muted',
          )}
          title={
            autoTidy
              ? 'Auto-layout is on: agent-placed nodes re-tidy as they appear. Click to turn off.'
              : 'Auto-layout is off. Click to turn on.'
          }
        >
          auto {autoTidy ? 'on' : 'off'}
        </button>
        <ContextMeter />
        <NotificationBell />
        <ThemeSwitch />
        <span
          className="font-mono text-[11px] text-fg-muted tabular-nums"
          data-tauri-drag-region
        >
          {sessions} sessions · {bus.length} ctx
          {totalCost > 0 && ` · $${totalCost.toFixed(3)}`}
        </span>
      </div>
    </header>
  )
}
