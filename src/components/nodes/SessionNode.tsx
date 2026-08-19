import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { CircleAlert, Hexagon, Loader2 } from 'lucide-react'
import { resolveCwd, useStore, type GtNode } from '@/lib/store'
import { PROVIDER_ACCENT, PROVIDER_LABEL, type SessionNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * An agent on the canvas, and nothing more.
 *
 * The transcript used to live here, which made every node a window that had to
 * be big enough to read and left the graph unreadable at any zoom that showed
 * more than three agents. The conversation and every setting now live in the
 * right dock; a node says who this agent is, whether it is working, and
 * whether it wants you — and clicking it points the dock at it.
 */
function SessionNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'session' }>) {
  const d = data as SessionNodeData
  // cwd comes from the graph, not from node state — the wiring is the truth.
  const cwd = useStore((s) => resolveCwd(s.nodes, s.edges, id))
  // Which conversation the dock is showing, so the two are visibly the same
  // thing rather than a node and an unrelated chat.
  const inDock = useStore(
    (s) =>
      s.libraryOpen &&
      s.rightTab === 'chat' &&
      (s.chatTarget === id || (s.chatTarget === null && d.role === 'orchestrator')),
  )

  const accent = PROVIDER_ACCENT[d.provider]
  const busy = d.state === 'thinking' || d.state === 'streaming'

  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!d.firedAt) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 700)
    return () => clearTimeout(t)
  }, [d.firedAt])

  return (
    <div
      className={cn(
        'gt-spawn flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 overflow-hidden rounded-xl border bg-panel/90 px-3 py-2 backdrop-blur transition-colors',
        selected || inDock ? 'border-line-strongest' : 'border-line',
        busy && 'gt-thinking',
        flash && 'gt-firing',
        d.state === 'error' && 'border-[var(--color-danger)]',
      )}
      style={
        {
          '--accent': accent,
          '--accent-dim': `color-mix(in oklch, ${accent} 30%, transparent)`,
          ...(d.role === 'orchestrator'
            ? { borderColor: `color-mix(in oklch, ${accent} 55%, transparent)` }
            : {}),
        } as React.CSSProperties
      }
      title={`${d.name} · ${PROVIDER_LABEL[d.provider]}${cwd ? `\n${cwd}` : ''}\nClick to open in the panel`}
    >
      {/* One direction only: everything an agent is given enters on the left,
          everything it produces leaves on the right. Keep the flow handles
          first — an edge that doesn't name a handle falls through to the first
          of its type. */}
      <Handle type="target" position={Position.Left} id="context-in" style={{ top: '28%' }} />
      <Handle type="target" position={Position.Left} id="spawned-by" style={{ top: '54%' }} />
      <Handle type="target" position={Position.Left} id="attach" style={{ top: '80%' }} />
      <Handle type="source" position={Position.Right} id="context-out" style={{ top: '28%' }} />
      <Handle type="source" position={Position.Right} id="spawns" style={{ top: '54%' }} />
      <Handle type="source" position={Position.Right} id="produces" style={{ top: '80%' }} />

      <div className="flex min-w-0 items-center gap-2">
        <Hexagon
          size={13}
          style={{ color: accent }}
          fill={d.role === 'orchestrator' ? accent : 'transparent'}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{d.name}</span>
        {busy ? (
          <Loader2 size={12} className="shrink-0 animate-spin" style={{ color: accent }} />
        ) : d.state === 'error' ? (
          <CircleAlert size={12} className="shrink-0 text-[var(--color-danger)]" />
        ) : d.awaitingUser ? (
          <span
            className="gt-caret h-2 w-2 shrink-0 rounded-full"
            style={{ background: 'var(--color-claude)' }}
            title="This agent ended its turn with a question — it's waiting on you."
          />
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-1.5 font-mono text-[9.5px] text-fg-faint">
        <span className="shrink-0">{PROVIDER_LABEL[d.provider]}</span>
        <span className="truncate">
          {cwd ? `▸ ${cwd.split('/').filter(Boolean).pop()}` : '▸ no folder'}
        </span>
        {busy && <span className="ml-auto shrink-0" style={{ color: accent }}>{d.state}</span>}
        {!busy && d.state === 'dead' && <span className="ml-auto shrink-0">dead</span>}
      </div>
    </div>
  )
}

export const SessionNode = memo(SessionNodeInner)
