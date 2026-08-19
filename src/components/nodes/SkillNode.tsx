import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore, type GtNode } from '@/lib/store'
import type { SkillNodeData, SkillTrigger } from '@/lib/types'
import { cn } from '@/lib/utils'

const TRIGGERS: SkillTrigger[] = ['on-attach', 'manual', 'always']

function SkillNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'skill' }>) {
  const d = data as SkillNodeData
  const update = useStore((s) => s.updateSkill)
  const removeNode = useStore((s) => s.removeNode)
  const [open, setOpen] = useState(false)

  return (
    <div
      className={cn(
        'gt-spawn w-60 overflow-hidden rounded-xl border bg-panel/90 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
      )}
    >
      {/* Flow runs left to right: capabilities feed in from the left edge. */}
      <Handle type="source" position={Position.Right} id="attach-out" />

      <header className="flex items-center gap-2 border-b border-line-soft px-2.5 py-1.5">
        <Sparkles size={12} className="shrink-0 text-fg-muted" />
        <input
          value={d.name}
          onChange={(e) => update(id, { name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none"
          spellCheck={false}
        />
        <Button variant="ghost" size="icon" onClick={() => removeNode(id)}>
          <Trash2 size={12} />
        </Button>
      </header>

      <div className="space-y-2 p-2.5">
        <input
          value={d.description}
          onChange={(e) => update(id, { description: e.target.value })}
          placeholder="One line — this is what routing reads"
          className="w-full bg-transparent text-[11.5px] leading-snug text-fg-muted outline-none placeholder:text-fg-faint"
        />

        <div className="flex gap-1">
          {TRIGGERS.map((t) => (
            <button
              key={t}
              onClick={() => update(id, { trigger: t })}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                d.trigger === t ? 'bg-surface-3 text-fg' : 'text-fg-subtle hover:bg-surface',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {open ? (
          <textarea
            autoFocus
            value={d.body}
            onChange={(e) => update(id, { body: e.target.value })}
            onBlur={() => setOpen(false)}
            rows={7}
            placeholder="Instructions injected into the agent…"
            className="nodrag w-full resize-none rounded-md border border-line bg-canvas p-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-fg-faint focus:border-line-strong"
          />
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="w-full rounded-md border border-dashed border-line px-2 py-1.5 text-left font-mono text-[10.5px] text-fg-subtle hover:border-line-strong hover:text-fg-muted"
          >
            {d.body ? `${d.body.slice(0, 60)}…` : 'write instructions…'}
          </button>
        )}
      </div>
    </div>
  )
}

export const SkillNode = memo(SkillNodeInner)
