import { useRef } from 'react'
import {
  commitPanels,
  resetPanelWidth,
  setPanelWidth,
  usePanels,
  type PanelKey,
} from '@/lib/panels'

/**
 * The drag handle between two floating panels.
 *
 * It lives *in* the `gap-2` rather than beside it: the negative margins cancel
 * both its own width and the extra gap it introduces, so adding one doesn't
 * move anything. Pointer capture means the drag survives the pointer leaving
 * the 8px strip, which at this width it does immediately.
 */
export function PanelDivider({ panel }: { panel: PanelKey }) {
  const { widths } = usePanels()
  const drag = useRef<{ x: number; from: number } | null>(null)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${panel} column`}
      title="Drag to resize · double-click to reset"
      className="group relative z-10 -mx-2 w-2 shrink-0 cursor-col-resize"
      onPointerDown={(e) => {
        e.preventDefault()
        drag.current = { x: e.clientX, from: widths[panel] }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        // Live, but unwritten: only the released width is worth persisting.
        setPanelWidth(panel, drag.current.from + (e.clientX - drag.current.x), false)
      }}
      onPointerUp={(e) => {
        if (!drag.current) return
        drag.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
        commitPanels()
      }}
      onDoubleClick={() => resetPanelWidth(panel)}
    >
      {/* Invisible until you reach for it — the gap between panels already
          reads as a seam. */}
      <div
        aria-hidden
        className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-line-strong"
      />
    </div>
  )
}
