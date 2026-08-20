import { useReactFlow, useViewport } from '@xyflow/react'
import { Lock, LockOpen, Maximize, Minus, Plus } from 'lucide-react'
import { densityForZoom } from '@/lib/density'
import { cn } from '@/lib/utils'

/**
 * Zoom, and what this zoom means.
 *
 * React Flow's own controls are three buttons and a percentage nobody reads.
 * The number that matters here is not the zoom but what the zoom is *doing* —
 * agent nodes change how much they say as you cross 50%, and a control that
 * silently rearranges the canvas should say so before it does. So the readout
 * names the density rather than the magnification.
 */
export function ZoomControls({
  locked,
  onToggleLock,
}: {
  locked: boolean
  onToggleLock: () => void
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  const density = densityForZoom(zoom)

  const Btn = ({
    onClick,
    title,
    children,
    on,
  }: {
    onClick: () => void
    title: string
    children: React.ReactNode
    on?: boolean
  }) => (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'grid h-6 w-6 place-items-center rounded-md transition-colors',
        on ? 'bg-surface-2 text-fg' : 'text-fg-subtle hover:bg-surface hover:text-fg-muted',
      )}
    >
      {children}
    </button>
  )

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-panel/90 p-1 backdrop-blur">
      <Btn onClick={() => zoomOut({ duration: 160 })} title="Zoom out">
        <Minus size={12} />
      </Btn>
      <Btn onClick={() => zoomIn({ duration: 160 })} title="Zoom in">
        <Plus size={12} />
      </Btn>
      <Btn
        onClick={() => fitView({ duration: 400, padding: 0.15 })}
        title="Fit the whole canvas  ⇧⏎"
      >
        <Maximize size={12} />
      </Btn>
      <Btn
        onClick={onToggleLock}
        on={locked}
        title={
          locked
            ? 'The canvas is locked: nodes cannot be dragged. Click to unlock.'
            : 'Lock the canvas so nothing moves while you read it.'
        }
      >
        {locked ? <Lock size={12} /> : <LockOpen size={12} />}
      </Btn>
      <span
        className="px-1.5 font-mono text-[9.5px] text-fg-faint tabular-nums"
        title={`${Math.round(zoom * 100)}% — agent nodes show their ${density} density at this zoom`}
      >
        {density}
      </span>
    </div>
  )
}
