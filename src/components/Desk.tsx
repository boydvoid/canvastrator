import { useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { addSeat, closeSeat, scrollBy, scrollTo, useDesk } from '@/lib/desk'
import { useCanvasStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * One dot per canvas on the desk.
 *
 * The dots are the only chrome the desk itself needs: everything else on
 * screen belongs to a canvas. Each says three things — where you are, how many
 * there are, and which of the ones you are *not* looking at have agents
 * running. That last one is the point of the whole arrangement. A canvas you
 * left working is invisible by definition, and a strip that gave no sign of it
 * would be a set of tabs you have to check by hand.
 */
function Dot({ index }: { index: number }) {
  const seat = useDesk((d) => d.strip[index])
  const at = useDesk((d) => d.at)
  const count = useDesk((d) => d.strip.length)
  // Read from that canvas's own store rather than the one in view — the whole
  // reason the dot is worth looking at.
  const name = useCanvasStore(seat.store, (s) => s.canvasName)
  const working = useCanvasStore(seat.store, (s) =>
    s.nodes.some(
      (n) => n.type === 'session' && (n.data.state === 'thinking' || n.data.state === 'streaming'),
    ),
  )
  const here = index === at

  return (
    <div className="group/dot relative flex items-center">
      <button
        onClick={() => scrollTo(index)}
        title={`${name}${working ? ' — working' : ''}`}
        className={cn(
          'relative h-2.5 rounded-full transition-all',
          here ? 'w-7 bg-fg' : 'w-2.5 bg-line-strong hover:bg-fg-muted',
        )}
      >
        {working && !here && (
          <span className="absolute inset-0 animate-pulse rounded-full bg-[var(--color-live)]" />
        )}
      </button>
      {/* Closing is deliberately not on the dot itself: the dots are a place
          you aim at quickly, and a target that sometimes deletes what you
          meant to visit is the wrong kind of small. */}
      {count > 1 && (
        <button
          onClick={() => closeSeat(seat.key)}
          title={`Close ${name}`}
          className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded p-0.5 text-fg-faint opacity-0 transition-opacity group-hover/dot:pointer-events-auto group-hover/dot:opacity-100 hover:text-fg-strong"
        >
          <X size={9} />
        </button>
      )}
    </div>
  )
}


/** The strip's own controls: where you are, and one more canvas. */
export function DeskBar() {
  const strip = useDesk((d) => d.strip)

  // ⌘⌥← / ⌘⌥→ walk the strip, the way a workspace switcher does. Held rather
  // than typed, because a bare arrow belongs to whatever has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.altKey) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        scrollBy(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        scrollBy(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-panel/85 px-3 py-2 backdrop-blur">
        {strip.map((seat, i) => (
          <Dot key={seat.key} index={i} />
        ))}
        <span className="mx-0.5 h-3 w-px bg-line" />
        <button
          onClick={() => addSeat()}
          title="Another canvas, beside this one"
          className="text-fg-faint transition-colors hover:text-fg-strong"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  )
}
