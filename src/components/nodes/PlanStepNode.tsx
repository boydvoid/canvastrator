import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Check, CircleAlert, Loader2, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlanStepNodeData } from '@/lib/plannodes'
import { useStore } from '@/lib/store'
import type { PlanStep } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATE_MARK: Record<PlanStep['state'], React.ReactNode> = {
  pending: null,
  running: <Loader2 size={11} className="animate-spin text-fg-muted" />,
  done: <Check size={11} className="text-[var(--color-live)]" />,
  failed: <CircleAlert size={11} className="text-[var(--color-danger)]" />,
}

/**
 * One step of the plan, on the canvas, with the trigger to run it.
 *
 * The step is read live from the store rather than taken from the node's data:
 * the node is rebuilt from the plan on every change anyway, and reading it
 * once here means the button can never act on a step that has moved on since
 * the node was drawn.
 */
function PlanStepNodeInner({ data }: NodeProps) {
  const { stepId, index } = data as PlanStepNodeData
  const step = useStore((s) => s.plan?.steps.find((x) => x.id === stepId))
  // Steps run one at a time, in order — the same rule the panel enforces.
  const busy = useStore((s) => !!s.plan?.steps.some((x) => x.state === 'running'))
  const approve = useStore((s) => s.approvePlanStep)
  const drop = useStore((s) => s.removePlanStep)

  // The plan changed under this node in the moment before it was rebuilt.
  if (!step) return null

  const pending = step.state === 'pending'

  return (
    <div
      className={cn(
        'gt-spawn flex h-full w-full flex-col overflow-hidden rounded-xl border bg-panel/90 px-2.5 py-1.5 backdrop-blur',
        step.state === 'failed'
          ? 'border-[color-mix(in_oklch,var(--color-danger)_35%,transparent)]'
          : 'border-line',
        step.state === 'done' && 'opacity-60',
        // A step waiting on you is the only one you can do anything about.
        pending && 'border-dashed',
      )}
    >
      {/* Flow runs left to right: the step before feeds in, the next one out. */}
      <Handle type="target" position={Position.Left} id="step-in" />
      <Handle type="source" position={Position.Right} id="step-out" />

      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-[10px] text-fg-faint tabular-nums">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
          {step.persona}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {STATE_MARK[step.state]}
          {pending && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void approve(step.id)}
                disabled={busy}
                title={busy ? 'Another step is running' : 'Run this step now'}
              >
                <Play size={11} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => drop(step.id)}
                title="Drop this step"
              >
                <Trash2 size={11} />
              </Button>
            </>
          )}
        </span>
      </div>

      {/* The task, as much as fits. It stays editable in the panel, which is
          where there is room to read the whole thing. */}
      <p className="mt-1 min-h-0 flex-1 overflow-hidden font-mono text-[10px] leading-relaxed text-fg-faint">
        {step.error ? (
          <span className="text-[var(--color-danger)]">{step.error}</span>
        ) : (
          step.task
        )}
      </p>
    </div>
  )
}

export const PlanStepNode = memo(PlanStepNodeInner)
