import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Plug, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore, type GtNode } from '@/lib/store'
import type { McpNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Whether the server is usable, in the words the CLI reports. */
const STATUS_TONE: Record<string, string> = {
  connected: 'text-[var(--color-live)]',
  failed: 'text-[var(--color-danger)]',
  'needs-auth': 'text-[var(--color-claude)]',
}

function McpNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'mcp' }>) {
  const d = data as McpNodeData
  const removeNode = useStore((s) => s.removeNode)
  const attachedTo = useStore(
    (s) => s.edges.filter((e) => e.source === id && e.type === 'attach').length,
  )
  const [open, setOpen] = useState(false)

  return (
    <div
      className={cn(
        'gt-spawn w-60 overflow-hidden rounded-xl border bg-panel/90 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
        d.status === 'failed' && 'border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)]',
      )}
    >
      {/* Wire into a session to grant it this server's tools. */}
      <Handle type="source" position={Position.Right} id="mcp-out" />

      <header className="flex items-center gap-2 border-b border-line-soft px-2.5 py-1.5">
        <Plug size={12} className={cn('shrink-0', STATUS_TONE[d.status ?? ''] ?? 'text-fg-subtle')} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{d.name}</span>
        <Button variant="ghost" size="icon" onClick={() => removeNode(id)} title="Remove">
          <Trash2 size={12} />
        </Button>
      </header>

      <div className="space-y-1 px-2.5 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="text-fg-subtle">{d.transport}</span>
          {d.status && (
            <span className={STATUS_TONE[d.status] ?? 'text-fg-subtle'}>{d.status}</span>
          )}
          <span className="ml-auto truncate text-fg-faint">{d.source}</span>
        </div>
        <div className="truncate font-mono text-[10px] text-fg-faint" title={d.url ?? d.command}>
          {d.url ?? d.command}
        </div>

        {d.tools?.length ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="w-full rounded px-1 py-0.5 text-left font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg-muted"
          >
            {d.tools.length} tools {open ? '▾' : '▸'}
          </button>
        ) : null}
        {open && d.tools && (
          <div className="nowheel max-h-32 space-y-0.5 overflow-y-auto border-l border-line pl-2">
            {d.tools.map((t) => (
              <div key={t} className="truncate font-mono text-[9.5px] text-fg-subtle">
                {t}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line-soft px-2.5 py-1 font-mono text-[10px] text-fg-faint">
        {attachedTo === 0
          ? 'wire into a session to grant its tools'
          : `attached to ${attachedTo} session${attachedTo > 1 ? 's' : ''}`}
      </div>
    </div>
  )
}

export const McpNode = memo(McpNodeInner)
