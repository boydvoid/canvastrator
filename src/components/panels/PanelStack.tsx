import { DecisionsPanel } from '@/components/panels/DecisionsPanel'
import { ChangesPanel } from '@/components/panels/ChangesPanel'
import { SharedPanel } from '@/components/panels/SharedPanel'
import { PersonasPanel } from '@/components/panels/PersonasPanel'
import { SkillsPanel } from '@/components/panels/SkillsPanel'
import { PulsePanel } from '@/components/panels/PulsePanel'
import { UsagePanel } from '@/components/panels/UsagePanel'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The floating readouts, stacked in the bottom-left of the canvas region.
 *
 * Screen space, not canvas space: these are siblings of the flow rather than
 * nodes inside it, so nothing here pans, zooms or has to be found again after
 * you move the canvas. That is the whole point — a log you navigate *from* and
 * a spend figure you keep an eye on are useless if they scroll away with the
 * work they describe.
 *
 * Where it sits is decided by what already owns the corners. The zoom controls
 * hold the very bottom-left, so the stack starts above them; the chatbox holds
 * the bottom-right, so the stack stays narrow and grows upward rather than
 * across.
 *
 * On a narrow window all three want the same space, and the stack used to
 * answer by disappearing — below 1120px with the drawer open, a panel you
 * opened from the rail lit its icon and then showed you nothing, which reads
 * as broken rather than as considered. So it overlaps instead, and the order
 * of who wins is set once, here:
 *
 *   - Over the drawer, because the drawer is transient. You opened a panel
 *     while a drawer happened to be out; the panel is the newer request.
 *   - Under the chatbox, because a panel over the chat input is worse than no
 *     panel at all. That is why `CentralChat` sits a layer above this one.
 */
export function PanelStack() {
  // The rail's drawer floats over the left of the canvas region. Sliding out
  // from under it beats being hidden by it, and the drawer is transient.
  const drawerOpen = useStore((s) => s.libraryOpen)

  return (
    <div
      className={cn(
        // 360px is the resting width, 288 the compact one. Which you get is
        // decided by the window rather than by a drag: a panel that keeps its
        // width while the canvas shrinks is a panel sitting on the work.
        'pointer-events-none absolute bottom-[3.5rem] z-20 flex max-h-[calc(100%-5rem)] w-[22.5rem] max-[64rem]:w-[18rem] flex-col justify-end gap-2 overflow-y-auto transition-[left] duration-200',
        // Beside the drawer where there is room for both, and back over it
        // where there is not — 1120px being 52px of rail, the 300px drawer,
        // this stack and the chatbox, side by side with their gaps.
        drawerOpen ? 'left-[316px] max-[70rem]:left-4' : 'left-4',
      )}
    >
      <PulsePanel />
      <DecisionsPanel />
      <SharedPanel />
      <ChangesPanel />
      <UsagePanel />
      <SkillsPanel />
      <PersonasPanel />
    </div>
  )
}
