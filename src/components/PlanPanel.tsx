import { useState } from 'react'
import { Check, CircleAlert, Loader2, Play, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { planLive } from '@/lib/plan'
import { useStore } from '@/lib/store'
import type { Plan, PlanStep } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATE_MARK = {
  pending: null,
  running: <Loader2 size={11} className="animate-spin text-fg-muted" />,
  done: <Check size={11} className="text-[var(--color-live)]" />,
  failed: <CircleAlert size={11} className="text-[var(--color-danger)]" />,
} satisfies Record<PlanStep['state'], React.ReactNode>

/**
 * One step, and the task it will be sent with.
 *
 * The task is editable right up to the moment it runs, because approving a
 * plan you can't correct is not approval — the whole point of stopping here is
 * that the orchestrator's brief is the thing most worth fixing, and it is
 * cheaper to fix a sentence than to interrupt an agent that misread it.
 */
function Step({ step, index, busy }: { step: PlanStep; index: number; busy: boolean }) {
  const edit = useStore((s) => s.editPlanStep)
  const drop = useStore((s) => s.removePlanStep)
  const approve = useStore((s) => s.approvePlanStep)
  const pending = step.state === 'pending'

  return (
    <li
      className={cn(
        'rounded-md border px-2 py-1.5',
        step.state === 'failed'
          ? 'border-[color-mix(in_oklch,var(--color-danger)_35%,transparent)]'
          : 'border-line',
        step.state === 'done' && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-[10px] text-fg-faint tabular-nums">
          {index + 1}
        </span>
        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
          {step.persona}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
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
              <Button variant="ghost" size="icon" onClick={() => drop(step.id)} title="Drop this step">
                <Trash2 size={11} />
              </Button>
            </>
          )}
        </span>
      </div>

      {pending ? (
        <textarea
          value={step.task}
          onChange={(e) => edit(step.id, e.target.value)}
          spellCheck={false}
          rows={2}
          className="mt-1 w-full resize-none rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[10.5px] leading-relaxed text-fg-muted outline-none hover:border-line focus:border-line-strong focus:text-fg"
        />
      ) : (
        <p className="mt-1 px-1 font-mono text-[10.5px] leading-relaxed text-fg-muted">
          {step.task}
        </p>
      )}

      {step.error && (
        <p className="px-1 font-mono text-[10px] text-[var(--color-danger)]">{step.error}</p>
      )}
    </li>
  )
}

/**
 * The plan the orchestrator proposed, and the gate on it.
 *
 * Planning mode exists because an orchestrator that spawns the moment it has
 * an idea has already spent the money and touched the repo by the time you
 * read what it decided. This is the pause: the whole job in one list, editable,
 * and nothing runs until you say so.
 */
export function PlanPanel({ plan }: { plan: Plan }) {
  const approveAll = useStore((s) => s.approvePlan)
  const discard = useStore((s) => s.discardPlan)
  const [open, setOpen] = useState(true)

  const pending = plan.steps.filter((s) => s.state === 'pending').length
  const busy = plan.steps.some((s) => s.state === 'running')
  const live = planLive(plan.steps)

  return (
    <div className="shrink-0 border-b border-line-soft bg-surface/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-surface/50"
      >
        <span className="font-mono text-[11px] text-fg">plan</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-faint">
          {plan.goal || `${plan.steps.length} steps`}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-fg-muted">
          {live ? `${pending} to approve` : 'done'}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-fg-faint">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-2.5 pb-2">
          <ol className="space-y-1">
            {plan.steps.map((step, i) => (
              <Step key={step.id} step={step} index={i} busy={busy} />
            ))}
          </ol>

          <div className="mt-2 flex items-center gap-1.5">
            {live && (
              <button
                onClick={() => void approveAll()}
                disabled={busy || !pending}
                className="rounded bg-surface-3 px-2 py-1 font-mono text-[10.5px] text-fg hover:bg-surface-2 disabled:opacity-40"
                title="Run every remaining step, in order"
              >
                {busy ? 'running…' : `approve ${pending === plan.steps.length ? 'plan' : 'rest'}`}
              </button>
            )}
            <button
              onClick={discard}
              disabled={busy}
              className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10.5px] text-fg-subtle hover:bg-surface hover:text-fg-muted disabled:opacity-40"
              title={live ? 'Throw the plan away' : 'Clear it from the panel'}
            >
              <X size={10} />
              {live ? 'discard' : 'clear'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
