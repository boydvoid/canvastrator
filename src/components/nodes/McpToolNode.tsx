import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Wrench } from 'lucide-react'
import { type GtNode } from '@/lib/store'
import type { McpToolNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

/** One MCP tool an agent actually called, and how often. */
function McpToolNodeInner({ data, selected }: NodeProps<GtNode & { type: 'mcptool' }>) {
  const d = data as McpToolNodeData

  // Flash on a repeat call, so a busy tool is visible without reading counts.
  const [hot, setHot] = useState(false)
  useEffect(() => {
    setHot(true)
    const t = setTimeout(() => setHot(false), 700)
    return () => clearTimeout(t)
  }, [d.lastAt])

  return (
    <div
      className={cn(
        'gt-spawn flex w-52 items-center gap-2 rounded-lg border bg-panel/90 px-2 py-1.5 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
        hot && 'gt-firing',
      )}
      style={{ '--accent': 'var(--color-live)' } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Top} id="from-server" />
      <Wrench size={11} className="shrink-0 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11px] text-fg" title={`${d.server} · ${d.tool}`}>
          {d.tool}
        </div>
        <div className="truncate font-mono text-[9.5px] text-fg-faint">{d.server}</div>
      </div>
      {d.calls > 1 && (
        <span className="shrink-0 rounded bg-surface-2 px-1 font-mono text-[9.5px] text-fg-muted">
          ×{d.calls}
        </span>
      )}
    </div>
  )
}

export const McpToolNode = memo(McpToolNodeInner)
