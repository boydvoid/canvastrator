import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FolderOpen, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pickPath } from '@/lib/bridge'
import { basename, useStore, type GtNode } from '@/lib/store'
import type { FolderNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

/** " session" / " sessions" — the noun only appears on the last count. */
const plural = (n: number) => ` session${n > 1 ? 's' : ''}`

function FolderNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'folder' }>) {
  const d = data as FolderNodeData
  const removeNode = useStore((s) => s.removeNode)
  // A folder may be one session's working directory and another's extra root
  // at the same time — primacy is a property of the edge, not the folder — so
  // the footer counts both and names each role.
  const cwdCount = useStore(
    (s) => s.edges.filter((e) => e.source === id && e.type === 'cwd').length,
  )
  const attachCount = useStore(
    (s) => s.edges.filter((e) => e.source === id && e.type === 'attach').length,
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
      {/* A folder feeds sessions; it never receives. One handle for both
          roles: the first folder wired into a session becomes its working
          directory and the rest are extra roots, so which of the two an edge
          is depends on the session it lands on, not on where it was dragged
          from. */}
      <Handle
        type="source"
        position={Position.Right}
        id="cwd-out"
        title="Drag onto a session — the first folder is its working directory, the rest are extra roots"
      />

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
        {cwdCount === 0 && attachCount === 0
          ? 'wire into a session to set its cwd'
          : [
              cwdCount ? `cwd for ${cwdCount}${attachCount ? '' : plural(cwdCount)}` : null,
              attachCount ? `reachable by ${attachCount}${plural(attachCount)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
      </div>
    </div>
  )
}

export const FolderNode = memo(FolderNodeInner)
