import { getCurrentWindow } from '@tauri-apps/api/window'
import { useReactFlow } from '@xyflow/react'
import { CanvasStatus } from '@/components/CanvasBar'
import { NotificationBell } from '@/components/NotificationBell'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { nowSentence, pulseNow } from '@/lib/pulse'
import { useStore, type GtNode } from '@/lib/store'
import type { PanelKey } from '@/lib/types'
import { canvasUsage, fmtUsd, type SessionLike } from '@/lib/usage'
import { cn } from '@/lib/utils'

/**
 * One of the three counts in the status strip.
 *
 * Zero is drawn, not hidden. A strip whose fields come and go changes width
 * every time an agent finishes, which is movement in the corner of your eye
 * that means nothing — and "0 needs you" is worth reading as an answer.
 */
function Stat({
  n,
  label,
  color,
  onClick,
  title,
}: {
  n: number
  label: string
  color: string
  onClick?: () => void
  title: string
}) {
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={onClick}
      title={title}
      className={cn(
        'flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] tabular-nums',
        n === 0 ? 'text-fg-faint' : 'text-fg-muted',
        onClick && 'hover:text-fg',
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: n === 0 ? 'var(--color-line-strong)' : color }}
      />
      {n} {label}
    </Tag>
  )
}

/**
 * The window's own title bar, replaced — and now the only chrome above the
 * canvas.
 *
 * It carries two readouts and no controls to speak of. On the left, which
 * canvas this is and whether it is saved. On the right, the two questions the
 * old bar answered badly: what is going on, and what is it costing. Both are
 * *links* — clicking either opens the panel that answers it properly. A
 * summary in a title bar should be a way in, not the whole answer.
 *
 * The native bar is hidden but the traffic lights stay, so everything here is
 * inset past them. The bar itself is a drag region — with no system title bar
 * the window would otherwise be unmovable except by its edges — and anything
 * interactive has to opt out of that, or clicking a button drags the window.
 */
export function AppBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const nodes = useStore((s) => s.nodes)
  const planning = useStore((s) => s.planning)
  const autoTidy = useStore((s) => s.autoTidy)
  const togglePlanning = useStore((s) => s.togglePlanning)
  const toggleAutoTidy = useStore((s) => s.toggleAutoTidy)
  const { fitView } = useReactFlow()

  const sessions = nodes.filter((n): n is GtNode & { type: 'session' } => n.type === 'session')
  const now = pulseNow(
    sessions.map((n) => ({
      state: n.data.state,
      awaitingUser: n.data.awaitingUser,
      ran: n.data.messages.some((m) => m.role === 'assistant' && !!m.text),
    })),
  )
  const total = canvasUsage(sessions.map((n) => ({ ...n.data, id: n.id }) as SessionLike))

  /**
   * Show the panel that answers this readout properly, open and expanded —
   * revealing a folded header would not have answered anything.
   */
  const reveal = (kind: PanelKey) => useStore.getState().showPanel(kind)

  /** The agent that has been waiting longest is the one to go to first. */
  const goToWaiting = () => {
    const waiting = sessions.find((n) => n.data.awaitingUser && n.data.state === 'idle')
    if (!waiting) return reveal('pulse')
    useStore.getState().setChatTarget(waiting.id)
    void fitView({ nodes: [{ id: waiting.id }], duration: 420, maxZoom: 1, padding: 0.4 })
  }

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
      className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-panel pr-3 pl-[86px] select-none"
    >
      <span className="font-mono text-[12.5px] tracking-tight text-fg" data-tauri-drag-region>
        canvas<span className="font-light text-fg-subtle">trator</span>
      </span>

      <span data-tauri-drag-region className="flex items-center">
        <CanvasStatus />
      </span>

      <span data-tauri-drag-region className="ml-auto flex items-center gap-3">
        <button
          onClick={onOpenPalette}
          title="Do anything  ⌘K"
          className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[10px] text-fg-subtle hover:text-fg-muted"
        >
          ⌘K
        </button>

        <span className="flex items-center gap-3 rounded-md border border-line bg-surface px-2.5 py-1">
          <Stat
            n={now.working}
            label="working"
            color="var(--color-claude)"
            title={nowSentence(now)}
          />
          <Stat
            n={now.needsYou + now.failed}
            label="need you"
            color="var(--color-danger)"
            onClick={goToWaiting}
            title="Agents that ended on a question, or failed. Click to go to the first."
          />
          <Stat
            n={now.landed}
            label="landed"
            color="var(--color-live)"
            onClick={() => reveal('pulse')}
            title="Agents that have run and are done. Click for the Pulse panel."
          />
        </span>

        <button
          onClick={() => reveal('usage')}
          title="What this canvas has spent, and how full each window is. Click for the Usage panel."
          className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-[10.5px] tabular-nums hover:border-line-strong"
        >
          <span className="text-fg">{fmtUsd(total.costUsd)}</span>
          {total.tightest?.use.fraction != null && (
            <>
              <span className="text-fg-faint">·</span>
              <span
                className={
                  total.tightest.use.fraction >= 0.9 ? 'text-[var(--color-danger)]' : 'text-fg-muted'
                }
              >
                {Math.round(total.tightest.use.fraction * 100)}% ctx
              </span>
            </>
          )}
        </button>

        <button
          onClick={togglePlanning}
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-surface hover:text-fg',
            planning ? 'text-fg-muted' : 'text-fg-faint',
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
            'rounded px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-surface hover:text-fg',
            autoTidy ? 'text-fg-muted' : 'text-fg-faint',
          )}
          title={
            autoTidy
              ? 'Auto-layout is on: agent-placed nodes re-tidy as they appear. Click to turn off.'
              : 'Auto-layout is off. Click to turn on.'
          }
        >
          auto {autoTidy ? 'on' : 'off'}
        </button>

        <NotificationBell />
        <ThemeSwitch />
      </span>
    </header>
  )
}
