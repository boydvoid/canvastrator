import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ScrollText, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore, type GtNode } from '@/lib/store'
import { PROVIDER_ACCENT, type SummaryNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Turns are minutes apart, not days — coarse is enough, and it never lies. */
function since(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

function SummaryNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'summary' }>) {
  const d = data as SummaryNodeData
  const removeNode = useStore((s) => s.removeNode)
  const select = useStore((s) => s.select)
  const accent = PROVIDER_ACCENT[d.provider]

  // Flash on arrival, the same way a touched file does — a node that appears
  // silently on a canvas you weren't watching is a node you never notice.
  const [fresh, setFresh] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setFresh(false), 900)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className={cn(
        'gt-spawn w-[260px] rounded-lg border bg-panel/90 backdrop-blur transition-colors',
        selected ? 'border-line-strongest' : 'border-line',
        fresh && 'gt-firing',
      )}
      style={
        {
          '--accent': accent,
          '--accent-dim': `color-mix(in oklch, ${accent} 30%, transparent)`,
        } as React.CSSProperties
      }
    >
      {/* Written to by its session; never wired anywhere itself. */}
      {/* An account of a turn is an output, so it hangs off the right
          like the files that turn touched. */}
      <Handle type="target" position={Position.Top} id="summarizes" />

      <div className="flex items-center gap-2 px-2 py-1.5">
        <ScrollText size={11} className="shrink-0" style={{ color: accent }} />
        <button
          onClick={() => select(d.sessionNodeId)}
          className="min-w-0 flex-1 truncate text-left font-mono text-[10.5px] text-fg-muted hover:underline"
          title="Select the session this came from"
        >
          {d.sessionName}
        </button>
        <span className="shrink-0 font-mono text-[9.5px] text-fg-faint">{since(d.ts)}</span>
        <Button variant="ghost" size="icon" onClick={() => removeNode(id)} title="Remove">
          <Trash2 size={11} />
        </Button>
      </div>

      <p className="border-t border-line-soft px-2 py-1.5 text-[11.5px] leading-[1.55] break-words text-fg">
        {d.headline}
      </p>

      {d.toolCount > 0 && (
        <div className="flex items-center gap-1.5 border-t border-line-soft px-2 py-1 font-mono text-[9.5px] text-fg-faint">
          <span className="shrink-0">
            {d.toolCount} {d.toolCount === 1 ? 'action' : 'actions'}
          </span>
          <span className="truncate opacity-70">{d.tools.join(' · ')}</span>
        </div>
      )}
    </div>
  )
}

export const SummaryNode = memo(SummaryNodeInner)
