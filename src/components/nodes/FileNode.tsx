import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileCode2, FilePen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFileActivity } from '@/lib/activity'
import { basename, useStore, type GtNode } from '@/lib/store'
import type { FileNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

const size = (b?: number) => {
  if (b === undefined) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function FileNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'file' }>) {
  const d = data as FileNodeData
  const removeNode = useStore((s) => s.removeNode)
  const openFile = useStore((s) => s.openFile)
  // What an agent is doing to this file right now, if anything.
  const activity = useFileActivity(id)

  // Green while being written or already written, plain while only being read.
  const accent =
    activity === 'write' || d.written ? 'var(--color-live)' : 'var(--color-fg-muted)'

  // Flash whenever an agent touches this file again.
  const [hot, setHot] = useState(false)
  useEffect(() => {
    if (!d.touchedAt) return
    setHot(true)
    const t = setTimeout(() => setHot(false), 900)
    return () => clearTimeout(t)
  }, [d.touchedAt])

  return (
    <div
      className={cn(
        'gt-spawn w-56 rounded-lg border bg-panel/90 backdrop-blur transition-colors',
        selected ? 'border-line-strongest' : 'border-line',
        // A sustained breath for as long as the agent is on this file; the
        // one-shot flash still marks each individual touch.
        activity && 'gt-thinking',
        hot && !activity && 'gt-firing',
        d.error && 'border-[var(--color-danger)]',
      )}
      style={
        {
          '--accent': accent,
          '--accent-dim': `color-mix(in oklch, ${accent} 35%, transparent)`,
        } as React.CSSProperties
      }
    >
      {/* Receives the touch edge from an agent; feeds context into a session. */}
      <Handle type="target" position={Position.Top} id="touched-by" />
      <Handle type="source" position={Position.Right} id="context-out" />

      <div className="flex items-center gap-2 px-2 py-1.5">
        {d.written ? (
          <FilePen size={12} className="shrink-0 text-[var(--color-live)]" />
        ) : (
          <FileCode2 size={12} className="shrink-0 text-fg-subtle" />
        )}
        <button
          onClick={() => openFile(d.path)}
          className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-fg hover:underline"
          title={`${d.path}\nClick to open`}
        >
          {basename(d.path)}
        </button>
        <Button variant="ghost" size="icon" onClick={() => removeNode(id)}>
          <Trash2 size={11} />
        </Button>
      </div>

      <div className="flex items-center gap-2 border-t border-line-soft px-2 py-1 font-mono text-[9.5px] text-fg-faint">
        {activity ? (
          <span
            className="flex items-center gap-1"
            style={{ color: accent }}
          >
            <span className="gt-caret h-1 w-1 rounded-full" style={{ background: accent }} />
            {activity === 'write' ? 'writing…' : 'reading…'}
          </span>
        ) : (
          <span>{d.origin === 'agent' ? (d.written ? 'written' : 'read') : 'attached'}</span>
        )}
        {d.binary && <span>binary</span>}
        <span className="ml-auto">{size(d.bytes)}</span>
      </div>

      {d.error && (
        <p className="border-t border-line-soft px-2 py-1 font-mono text-[9.5px] text-[var(--color-danger)]">
          {d.error}
        </p>
      )}
    </div>
  )
}

export const FileNode = memo(FileNodeInner)
