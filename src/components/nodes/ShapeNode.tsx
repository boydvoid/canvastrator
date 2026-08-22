import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ListChecks, TriangleAlert, X } from 'lucide-react'
import { fansOut, MAX_FANOUT, pattern as patternOf } from '@/lib/patterns'
import { planSentence, progressLabel, runLabel } from '@/lib/plansay'
import { planLive, stepReady } from '@/lib/plan'
import type { ShapeNodeData } from '@/lib/plannodes'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The plan, at the head of the steps it produced.
 *
 * The shape an orchestrator picks is the most consequential thing it decides —
 * it is why the next thing to happen is three agents rather than one, and it
 * is decided before any of them exist. But it was drawn in the app's own
 * vocabulary: a card headed SHAPE, a pattern id for a title, and a glyph of
 * dots that had to be learned before it said anything. The question in front
 * of the user at that moment is simpler than that — what is about to happen,
 * how much of it, and do I want it — so the card answers that first and keeps
 * the taxonomy as a footnote.
 *
 * It sits above the agent that made it with the steps running to its right,
 * joined by a rail in the pattern's own colour: the decision, then what came
 * of it, read left to right in the order it happened.
 *
 * Everything is read live from the plan. Like the step nodes, this is derived
 * and never stored — see `plannodes.ts`.
 */
function ShapeNodeInner({ data }: NodeProps) {
  const { planId } = data as ShapeNodeData
  const plan = useStore((s) => s.plans.find((p) => p.id === planId) ?? null)
  const approveAll = useStore((s) => s.approvePlan)
  const discard = useStore((s) => s.discardPlan)

  // The plan changed under this node in the moment before it was rebuilt.
  if (!plan?.pattern) return null

  const shape = patternOf(plan.pattern.id)
  const done = plan.steps.filter((s) => s.state === 'done').length
  const running = plan.steps.some((s) => s.state === 'running')
  const pending = plan.steps.filter((s) => s.state === 'pending').length
  const live = planLive(plan.steps)
  // A step you added and have not said anything about yet. The plan cannot run
  // past it, so the button says that rather than starting a run that stops one
  // step later for a reason nothing on screen explains.
  const unwritten = plan.steps.some((s) => s.state === 'pending' && !stepReady(s))
  // A fan-out that the app demoted to running in order is not a fan-out any
  // more, and the button must not promise a parallel start it will not make.
  const parallel = fansOut(plan.pattern.id) && !plan.warning
  // The step you are *on* is the one running; with none running, the count of
  // finished steps is how far it got. Reported as a position rather than a
  // percentage, because a plan is a list and you are somewhere in it.
  const at = running ? done + 1 : done

  return (
    <div
      className={cn(
        'gt-spawn flex h-full w-full flex-col overflow-hidden rounded-xl border bg-panel/90 backdrop-blur',
        plan.warning ? 'border-[var(--color-danger)]' : 'border-line-strong',
      )}
    >
      <Handle type="target" position={Position.Bottom} id="shape-in" />
      <Handle type="source" position={Position.Right} id="shape-out" />

      <div className="flex items-center gap-2 bg-surface-2/70 px-3 py-1.5">
        <ListChecks size={11} className="shrink-0 text-fg-muted" />
        <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">PLAN</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-subtle tabular-nums">
          {progressLabel(at, plan.steps.length)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2.5">
        {/* What is about to happen, before why it was chosen. */}
        <p className="font-slab text-[14px] leading-tight font-medium text-fg-strong">
          {planSentence(plan.pattern.id, plan.steps.length)}
        </p>
        <p className="line-clamp-2 text-[11.5px] leading-[1.42] text-fg-muted">
          {plan.pattern.why}
        </p>

        {/* The taxonomy, kept because it is what these patterns are called
            everywhere else, and demoted because nobody was asking. */}
        <div className="mt-auto flex items-center gap-1.5">
          <span
            className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[9px] text-fg-subtle"
            title={`${shape.fit} Costs ${shape.cost}.`}
          >
            {shape.name}
          </span>
          <span
            className="ml-auto shrink-0 truncate font-mono text-[9px] text-fg-faint"
            title={shape.cost}
          >
            {parallel ? 'at once' : 'in order'}
          </span>
        </div>
      </div>

      {/* The plan as a whole lives here, because the shape is what a plan *is*
          — the steps to the right are what it came to. Per-step approval stays
          on the steps. */}
      <div className="flex items-center gap-2 border-t border-line-soft bg-canvas/40 px-2.5 py-1.5">
        {live && (
          <button
            onClick={() => void approveAll(planId)}
            disabled={running || !pending || unwritten}
            title={
              unwritten
                ? 'A step you added still needs a persona and a task'
                : parallel
                  ? `Every remaining step starts now, ${MAX_FANOUT} at a time`
                  : 'Every remaining step runs, one after another'
            }
            className="rounded-md bg-fg px-2.5 py-1 font-mono text-[10px] text-canvas hover:brightness-110 disabled:opacity-40"
          >
            {running
              ? 'running…'
              : unwritten
                ? 'Finish your step first'
                : runLabel(pending, plan.steps.length, parallel)}
          </button>
        )}
        <button
          onClick={() => discard(planId)}
          disabled={running}
          title={live ? 'Throw the plan away' : 'Clear it from the canvas'}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg-muted disabled:opacity-40"
        >
          <X size={9} />
          {live ? 'discard' : 'clear'}
        </button>
      </div>

      {/* The shape it declared and the plan it wrote disagree. Kept visible
          rather than shown once, because it is the reason the plan will run in
          order despite what its shape says. */}
      {plan.warning && (
        <div className="flex items-start gap-2 border-t border-line-soft bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-3 py-2">
          <TriangleAlert size={11} className="mt-px shrink-0 text-[var(--color-danger)]" />
          <p className="text-[10.5px] leading-snug text-fg-muted">{plan.warning}</p>
        </div>
      )}
    </div>
  )
}

export const ShapeNode = memo(ShapeNodeInner)
