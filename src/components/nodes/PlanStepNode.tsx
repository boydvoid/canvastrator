import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Check, CircleAlert, Loader2, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { stepReady } from '@/lib/plan'
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
 *
 * A step that has not run yet is editable in place — both the one you added
 * from the gap beside it and the one the orchestrator wrote. There is no edit
 * mode to enter: a plan is a proposal, everything still pending in it is still
 * a question, and a field you have to unlock first is a field most people
 * never find. The fields are dressed as the text they replaced, so a plan you
 * are only reading looks exactly as it did.
 */
function PlanStepNodeInner({ data }: NodeProps) {
  const { planId, stepId, index, count } = data as PlanStepNodeData
  const plan = useStore((s) => s.plans.find((p) => p.id === planId))
  const step = plan?.steps.find((x) => x.id === stepId)
  // Steps run one at a time, in order — within this plan. Another plan on the
  // same orchestrator is another job, and it is not what this step waits for.
  const busy = !!plan?.steps.some((x) => x.state === 'running')
  const approve = useStore((s) => s.approvePlanStep)
  const edit = useStore((s) => s.editPlanStep)
  const drop = useStore((s) => s.removePlanStep)
  // The personas this canvas can actually spawn. A step naming anything else
  // fails at the moment it runs, which is the worst moment to find out.
  const roster = useStore((s) => s.library)

  // The plan changed under this node in the moment before it was rebuilt.
  if (!step) return null

  const pending = step.state === 'pending'
  const ready = stepReady(step)
  // A step written by an orchestrator that named a persona this canvas does
  // not have. Kept in the list rather than silently swapped for a blank, so
  // the field shows what the plan actually says.
  const stranger = !!step.persona && !roster.some((p) => p.name === step.persona)

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
        {/* Its place in the whole, not just its number: a step that says 2/3
            belongs to a plan, and one that says 2 is a box with a 2 on it. */}
        <span className="shrink-0 font-mono text-[10px] text-fg-faint tabular-nums">
          {index + 1}
          <span className="text-fg-faint/60">/{count}</span>
        </span>
        {pending ? (
          <select
            // Chosen from a list rather than typed: the persona is what
            // decides which agent this becomes, and a name the library does
            // not have is a step that fails on the way out of the gate.
            className={cn(
              'nodrag min-w-0 flex-1 truncate rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] outline-none focus:ring-1 focus:ring-line-strong',
              step.persona ? 'text-fg-muted' : 'text-fg-faint',
            )}
            value={step.persona}
            // Autofocus lands on the step you just added — a blank one is
            // always one you opened a moment ago — so it can be filled in
            // without going looking for the field.
            autoFocus={!step.persona && !step.task}
            onChange={(e) => edit(step.id, { persona: e.target.value })}
            title="Which agent this step becomes"
          >
            <option value="">persona…</option>
            {stranger && <option value={step.persona}>{step.persona} (not in library)</option>}
            {roster.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
            {step.persona}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-0.5">
          {STATE_MARK[step.state]}
          {pending && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void approve(step.id)}
                disabled={busy || !ready}
                title={
                  busy
                    ? 'Another step is running'
                    : !ready
                      ? 'Say who this step is and what it does first'
                      : 'Run this step now'
                }
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

      {/* The task, as much as fits — and while the step is still pending, the
          place to say what it is. */}
      {pending ? (
        <textarea
          className="nodrag nowheel mt-1 min-h-0 flex-1 resize-none bg-transparent font-mono text-[10px] leading-relaxed text-fg-faint outline-none placeholder:text-fg-faint/50 focus:text-fg-muted"
          value={step.task}
          placeholder="what this step should do…"
          onChange={(e) => edit(step.id, { task: e.target.value })}
        />
      ) : (
        <p className="mt-1 min-h-0 flex-1 overflow-hidden font-mono text-[10px] leading-relaxed text-fg-faint">
          {step.error ? (
            <span className="text-[var(--color-danger)]">{step.error}</span>
          ) : (
            step.task
          )}
        </p>
      )}
    </div>
  )
}

export const PlanStepNode = memo(PlanStepNodeInner)
