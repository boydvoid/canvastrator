import { Library } from 'lucide-react'
import { FloatingPanel } from '@/components/panels/FloatingPanel'
import { LibraryContent } from '@/components/LibraryPanel'
import { useStore } from '@/lib/store'

/**
 * The persona library, floating rather than docked.
 *
 * The rows are unchanged — `LibraryContent` owns those, and it is the same
 * list the drawer showed. What changed is where it sits: starting an agent
 * from a persona means seeing where it will land, and a 300px drawer covering
 * the left of the canvas hid exactly that.
 */
export function PersonasPanel() {
  const count = useStore((s) => s.library.length)

  return (
    <FloatingPanel
      panel="personas"
      title="PERSONAS"
      Icon={Library}
      badge={<span className="font-mono text-[9.5px] text-fg-subtle tabular-nums">{count}</span>}
    >
      {/* Capped rather than free-growing: a library of thirty would otherwise
          push the other two panels off the top of the window. */}
      <div className="flex max-h-[22rem] flex-col overflow-hidden">
        <LibraryContent />
      </div>
    </FloatingPanel>
  )
}
