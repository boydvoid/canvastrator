import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileCode2, FilePen } from 'lucide-react'
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

/**
 * A file an agent touched — a chip, not a card.
 *
 * A working agent puts a dozen of these under itself, and at the old two-line
 * size that column was taller than the rest of the flow put together. Name,
 * what was done to it, and whether something is happening to it right now is
 * the whole job; the path, the size and the contents are one click away in
 * the viewer.
 *
 * It sizes to its own name rather than to a fixed box. A column of short names
 * in fixed 196px boxes reads as a column of half-empty containers, and the
 * layout only needs the widest of them — which it measures.
 */
function FileNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'file' }>) {
  const d = data as FileNodeData
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
        'gt-spawn flex min-w-0 items-center gap-1.5 rounded-lg border bg-panel/90 px-2 py-1.5 backdrop-blur transition-colors',
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
      <Handle type="target" position={Position.Left} id="touched-by" />
      <Handle type="source" position={Position.Right} id="context-out" />

      {d.written ? (
        <FilePen size={11} className="shrink-0 text-[var(--color-live)]" />
      ) : (
        <FileCode2 size={11} className="shrink-0 text-fg-subtle" />
      )}
      <button
        onClick={() => openFile(d.path)}
        className="max-w-[220px] min-w-0 truncate text-left font-mono text-[11px] text-fg hover:underline"
        title={[d.path, d.error, size(d.bytes), 'Click to open'].filter(Boolean).join('\n')}
      >
        {basename(d.path)}
      </button>

      {/* What was done to it, said rather than implied by an icon's colour. A
          written file is the one you may want to look at before keeping it,
          and "read" and "attached" are different enough to be worth naming:
          one is the agent's own doing, the other is yours. */}
      <span
        className="shrink-0 font-mono text-[8.5px]"
        style={{ color: d.written ? 'var(--color-live)' : 'var(--color-fg-faint)' }}
      >
        {d.origin === 'agent' ? (d.written ? 'written' : 'read') : 'attached'}
      </span>
      {activity && (
        <span
          className="gt-caret h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: accent }}
          title={activity === 'write' ? 'writing…' : 'reading…'}
        />
      )}
      {d.error && <span className="shrink-0 text-[10px] text-[var(--color-danger)]">!</span>}
    </div>
  )
}

export const FileNode = memo(FileNodeInner)
