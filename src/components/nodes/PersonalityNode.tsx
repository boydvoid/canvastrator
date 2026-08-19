import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Trash2, UserRoundCog } from 'lucide-react'
import { EffortField } from '@/components/EffortField'
import { ModelField } from '@/components/ModelField'
import { Button } from '@/components/ui/button'
import { useStore, type GtNode } from '@/lib/store'
import {
  PERMISSION_LABEL,
  PROVIDER_ACCENT,
  PROVIDER_LABEL,
  type Permission,
  type PersonalityNodeData,
  type Provider,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const PROVIDERS: Provider[] = ['claude', 'codex', 'opencode']
const PERMISSIONS: Permission[] = ['plan', 'auto', 'full']

function PersonalityNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'personality' }>) {
  const d = data as PersonalityNodeData
  const update = useStore((s) => s.updatePersonality)
  const removeNode = useStore((s) => s.removeNode)
  const attachedTo = useStore(
    (s) => s.edges.filter((e) => e.source === id && e.type === 'attach').length,
  )
  const spawned = useStore(
    (s) =>
      s.nodes.filter((n) => n.type === 'session' && n.data.name.startsWith(d.name)).length,
  )

  const [editing, setEditing] = useState(false)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!d.firedAt) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 700)
    return () => clearTimeout(t)
  }, [d.firedAt])

  const accent = PROVIDER_ACCENT[d.provider]

  return (
    <div
      className={cn(
        'gt-spawn w-64 overflow-hidden rounded-xl border bg-panel/90 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
        flash && 'gt-firing',
      )}
      style={{ '--accent': accent } as React.CSSProperties}
    >
      {/* Wire into a session to grant it the right to spawn this. */}
      <Handle type="source" position={Position.Right} id="spawnable-by" />

      <header className="flex items-center gap-2 border-b border-line-soft px-2.5 py-1.5">
        <UserRoundCog size={12} className="shrink-0" style={{ color: accent }} />
        <input
          value={d.name}
          onChange={(e) => update(id, { name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-fg outline-none"
          spellCheck={false}
        />
        <Button variant="ghost" size="icon" onClick={() => removeNode(id)} title="Remove">
          <Trash2 size={12} />
        </Button>
      </header>

      <div className="space-y-2 p-2.5">
        <input
          value={d.description}
          onChange={(e) => update(id, { description: e.target.value })}
          placeholder="When the orchestrator should use this"
          className="w-full bg-transparent text-[11.5px] leading-snug text-fg-muted outline-none placeholder:text-fg-faint"
          title="The orchestrator reads this when deciding what to spawn — be specific."
        />

        <div className="flex flex-wrap gap-1">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => update(id, { provider: p })}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                d.provider === p ? 'text-fg' : 'text-fg-subtle hover:bg-surface',
              )}
              style={
                d.provider === p
                  ? { background: `color-mix(in oklch, ${PROVIDER_ACCENT[p]} 20%, transparent)` }
                  : undefined
              }
            >
              {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>

        <ModelField
          provider={d.provider}
          value={d.model}
          onChange={(model) => update(id, { model })}
        />

        <EffortField value={d.effort} onChange={(effort) => update(id, { effort })} />

        <div className="flex gap-1">
          {PERMISSIONS.map((p) => (
            <button
              key={p}
              onClick={() => update(id, { permission: p })}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                d.permission === p
                  ? p === 'full'
                    ? 'bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]'
                    : 'bg-surface-3 text-fg'
                  : 'text-fg-subtle hover:bg-surface',
              )}
            >
              {PERMISSION_LABEL[p]}
            </button>
          ))}
        </div>

        {editing ? (
          <textarea
            autoFocus
            value={d.instructions}
            onChange={(e) => update(id, { instructions: e.target.value })}
            onBlur={() => setEditing(false)}
            rows={7}
            placeholder="Opening brief for every agent spawned from this personality…"
            className="nodrag w-full resize-none rounded-md border border-line bg-canvas p-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-fg-faint focus:border-line-strong"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="w-full rounded-md border border-dashed border-line px-2 py-1.5 text-left font-mono text-[10.5px] text-fg-subtle hover:border-line-strong hover:text-fg-muted"
          >
            {d.instructions ? `${d.instructions.slice(0, 60)}…` : 'write the brief…'}
          </button>
        )}
      </div>

      <div className="border-t border-line-soft px-2.5 py-1 font-mono text-[10px] text-fg-faint">
        {attachedTo === 0
          ? 'wire into an orchestrator to let it spawn this'
          : `spawnable by ${attachedTo} · ${spawned} live`}
      </div>
    </div>
  )
}

export const PersonalityNode = memo(PersonalityNodeInner)
