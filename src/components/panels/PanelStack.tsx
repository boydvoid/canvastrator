import { PersonasPanel } from '@/components/panels/PersonasPanel'
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
 * Below a certain width the two would meet, and a panel over the chat input is
 * worse than no panel at all — so the stack steps aside until the window is
 * big enough for both. The two thresholds are that sum, not round numbers:
 * 52px rail + 16 + 304 wide + 16 gap + 416 of chatbox + 16 is 820px, and
 * shifting clear of the 300px drawer pushes the same sum to 1120px.
 */
export function PanelStack() {
  // The rail's drawer floats over the left of the canvas region. Sliding out
  // from under it beats being hidden by it, and the drawer is transient.
  const drawerOpen = useStore((s) => s.libraryOpen)

  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-[3.5rem] z-20 flex max-h-[calc(100%-5rem)] w-[19rem] flex-col justify-end gap-2 overflow-y-auto transition-[left] duration-200',
        drawerOpen ? 'left-[316px] max-[70rem]:hidden' : 'left-4 max-[52rem]:hidden',
      )}
    >
      <PulsePanel />
      <UsagePanel />
      <PersonasPanel />
    </div>
  )
}
