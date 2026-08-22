import { memo } from 'react'
import { Plus } from 'lucide-react'
import type { NodeProps } from '@xyflow/react'
import type { PlanAddNodeData } from '@/lib/plannodes'
import { useStore } from '@/lib/store'

/**
 * Somewhere to put a step of your own, in the gap where it would go.
 *
 * A plan arrives as a proposal, and until now the only answers to it were run
 * it, drop a step, or throw it away — every one of them subtractive. But the
 * common amendment is additive and positional: a review before the
 * implementer, a second look before the thing lands. Asking the orchestrator
 * to write the whole plan again to get it is a long way round for a step you
 * already know the shape of.
 *
 * So the gaps are the affordance. Clicking one opens a blank step in that
 * position, which the node itself is then waiting to be told about — see
 * `PlanStepNode`, where a step with nothing in it yet is a step with its
 * fields open.
 */
function PlanAddNodeInner({ data }: NodeProps) {
  const { planId, index } = data as PlanAddNodeData
  const add = useStore((s) => s.addPlanStep)

  return (
    <button
      // `nodrag` so the click lands here rather than starting a pan.
      className="nodrag flex h-full w-full items-center justify-center rounded-full border border-dashed border-line bg-panel/70 text-fg-faint backdrop-blur transition-colors hover:border-fg-muted hover:text-fg-strong"
      onClick={() => add(planId, index)}
      title="Add a step of your own here"
    >
      <Plus size={11} />
    </button>
  )
}

export const PlanAddNode = memo(PlanAddNodeInner)
