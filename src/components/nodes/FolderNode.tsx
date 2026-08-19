import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FolderOpen, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pickPath } from '@/lib/bridge'
import { basename, useStore, type GtNode } from '@/lib/store'
import type { FolderNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

function FolderNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'folder' }>) {
  const d = data as FolderNodeData
  const removeNode = useStore((s) => s.removeNode)
  const sessionCount = useStore(
    (s) => s.edges.filter((e) => e.source === id && e.type === 'cwd').length,
  )

  const rechoose = async () => {
    const picked = await pickPath(true)
    if (!picked) return
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && n.type === 'folder'
          ? { ...n, data: { ...n.data, path: picked, missing: false } }
          : n,
      ) as GtNode[],
    }))
  }

  return (
    <div
      className={cn(
        'gt-spawn w-64 rounded-xl border bg-panel/90 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
        d.missing && 'border-[var(--color-danger)]',
      )}
    >
      {/* A folder feeds sessions; it never receives. */}
      <Handle type="source" position={Position.Right} id="cwd-out" />

      <div className="flex items-center gap-2 px-2.5 py-2">
        {d.missing ? (
          <TriangleAlert size={13} className="shrink-0 text-[var(--color-danger)]" />
        ) : (
          <FolderOpen size={13} className="shrink-0 text-fg-muted" />
        )}
        <button
          onClick={rechoose}
          className="min-w-0 flex-1 text-left"
          title={`${d.path}\nClick to choose another folder`}
        >
          <div className="truncate font-mono text-[12px] text-fg">{basename(d.path)}</div>
          <div className="truncate font-mono text-[10px] text-fg-faint">
            {d.missing ? 'folder not found' : d.path.replace(/^\/Users\/[^/]+/, '~')}
          </div>
        </button>
        <Button variant="ghost" size="icon" onClick={() => removeNode(id)} title="Remove">
          <Trash2 size={12} />
        </Button>
      </div>

      <div className="border-t border-line-soft px-2.5 py-1 font-mono text-[10px] text-fg-faint">
        {sessionCount === 0
          ? 'wire into a session to set its cwd'
          : `cwd for ${sessionCount} session${sessionCount > 1 ? 's' : ''}`}
      </div>
    </div>
  )
}

export const FolderNode = memo(FolderNodeInner)
