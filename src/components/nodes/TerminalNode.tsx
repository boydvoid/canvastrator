import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { SquareTerminal } from 'lucide-react'
import { folderRootsFor, useStore, type GtNode } from '@/lib/store'
import type { TerminalNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * A shell on the canvas.
 *
 * The node is a label, not a window — the same choice the agent nodes make.
 * A terminal is something you read a screenful of at a time and type into, and
 * neither fits in a box you can zoom away from; clicking it puts the real
 * thing in the chat area, at a size you can work in.
 */
function TerminalNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'terminal' }>) {
  const d = data as TerminalNodeData
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const setChatTarget = useStore((s) => s.setChatTarget)

  const cwd = folderRootsFor(nodes, edges, id).find((r) => r.primary)?.path

  return (
    <div
      onClick={() => setChatTarget(id)}
      className={cn(
        'gt-spawn flex w-60 cursor-pointer items-center gap-2 rounded-lg border bg-panel/90 px-2.5 py-2 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
      )}
      title="Open this terminal in the chat area"
    >
      <Handle type="target" position={Position.Left} id="cwd-in" />
      <SquareTerminal
        size={12}
        className={cn('shrink-0', d.running ? 'text-[var(--color-live)]' : 'text-fg-muted')}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11.5px] text-fg">{d.name}</div>
        <div className="truncate font-mono text-[9.5px] text-fg-faint" title={cwd}>
          {cwd ? cwd.replace(/^\/Users\/[^/]+/, '~') : 'wire in a folder'}
        </div>
      </div>
      {/* Three states worth telling apart: never started, running, and ended —
          the last of which a plain dot would render as "off" and hide. */}
      <span className="shrink-0 font-mono text-[9.5px] text-fg-faint">
        {d.running ? 'live' : d.exit ? `exit ${d.exit.code ?? '—'}` : ''}
      </span>
    </div>
  )
}

export const TerminalNode = memo(TerminalNodeInner)
