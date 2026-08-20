import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitFork, TriangleAlert, X } from 'lucide-react'
import { fansOut, MAX_FANOUT, pattern as patternOf, type PatternId } from '@/lib/patterns'
import { planLive } from '@/lib/plan'
import type { ShapeNodeData } from '@/lib/plannodes'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The shape drawn as the flow it describes.
 *
 * Six glyphs, one per pattern, each a root and what comes off it. They are not
 * decoration: the point of naming a shape is that the work has a form, and a
 * three-dot fan says "these run at once" faster than the sentence under it
 * ever will.
 */
function Glyph({ id }: { id: PatternId }) {
  const dot = (key: string, tone: 'root' | 'leaf' | 'dim' = 'leaf') => (
    <span
      key={key}
      className="h-[7px] w-[7px] shrink-0 rounded-full"
      style={{
        background:
          tone === 'root'
            ? 'var(--color-claude)'
            : tone === 'dim'
              ? 'var(--color-line-strong)'
              : 'var(--color-edge-muted)',
      }}
    />
  )
  const rule = (key: string) => (
    <span key={key} className="h-px w-3 shrink-0 bg-[var(--color-edge)]" />
  )
  const fan = (tones: ('leaf' | 'dim')[]) => (
    <span className="flex flex-col gap-[3px]">{tones.map((t, i) => dot(`f${i}`, t))}</span>
  )

  switch (id) {
    case 'single':
      return (
        <span className="flex items-center gap-1.5">
          {dot('a', 'root')}
          {rule('r')}
          {dot('b')}
        </span>
      )
    case 'chain':
      return (
        <span className="flex items-center gap-1.5">
          {dot('a', 'root')}
          {rule('r1')}
          {dot('b')}
          {rule('r2')}
          {dot('c')}
        </span>
      )
    case 'route':
      // Only one branch is taken, which is the entire difference between
      // routing and a fan-out. The other two are drawn as roads not travelled.
      return (
        <span className="flex items-center gap-1.5">
          {dot('a', 'root')}
          {rule('r')}
          {fan(['dim', 'leaf', 'dim'])}
        </span>
      )
    case 'parallel':
      return (
        <span className="flex items-center gap-1.5">
          {dot('a', 'root')}
          {rule('r')}
          {fan(['leaf', 'leaf', 'leaf'])}
        </span>
      )
    case 'orchestrate':
      return (
        <span className="flex items-center gap-1.5">
          {dot('a', 'root')}
          {rule('r1')}
          {fan(['leaf', 'leaf', 'leaf'])}
          {rule('r2')}
          {dot('z', 'root')}
        </span>
      )
    case 'evaluate':
      return (
        <span className="flex items-center gap-1.5">
          {dot('a', 'root')}
          <span className="flex flex-col items-center gap-[2px]">
            {rule('r1')}
            {rule('r2')}
          </span>
          {dot('b')}
        </span>
      )
  }
}

/**
 * The shape the orchestrator committed to, on the canvas.
 *
 * A shape is the most consequential thing an orchestrator decides — it is why
 * the next thing to happen is three agents rather than one, and it is decided
 * before any of them exist. It lived in a panel, which meant the canvas showed
 * the consequences of a decision it could not show.
 *
 * So it sits above the agent that made it, with the steps it produced running
 * to its right: the decision, then what came of it, read left to right in the
 * order it happened.
 *
 * Everything is read live from the plan. Like the step nodes, this is derived
 * and never stored — see `plannodes.ts`.
 */
function ShapeNodeInner({ data }: NodeProps) {
  const { fromNodeId } = data as ShapeNodeData
  const plan = useStore((s) => (s.plan?.fromNodeId === fromNodeId ? s.plan : null))
  const approveAll = useStore((s) => s.approvePlan)
  const discard = useStore((s) => s.discardPlan)

  // The plan changed under this node in the moment before it was rebuilt.
  if (!plan?.pattern) return null

  const shape = patternOf(plan.pattern.id)
  const done = plan.steps.filter((s) => s.state === 'done').length
  const running = plan.steps.some((s) => s.state === 'running')
  const pending = plan.steps.filter((s) => s.state === 'pending').length
  const live = planLive(plan.steps)
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
        <GitFork size={11} className="shrink-0 text-fg-muted" />
        <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">SHAPE</span>
        <span className="ml-auto truncate font-mono text-[10.5px] text-fg" title={shape.name}>
          {plan.pattern.id}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3 py-2.5">
        <p className="line-clamp-3 text-[11.5px] leading-[1.42] text-fg-muted">
          {plan.pattern.why}
        </p>

        <div className="mt-auto flex items-center gap-2">
          <Glyph id={plan.pattern.id} />
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-fg-faint tabular-nums">
            {at > 0 ? `step ${at} of ${plan.steps.length}` : `${plan.steps.length} steps`}
          </span>
        </div>
      </div>

      {/* The plan as a whole lives with the shape, because the shape is what a
          plan *is* — the steps to its right are what it came to. Per-step
          approval stays on the steps. */}
      <div className="flex items-center gap-1.5 border-t border-line-soft bg-canvas/40 px-2.5 py-1.5">
        {live && (
          <button
            onClick={() => void approveAll()}
            disabled={running || !pending}
            title={
              parallel
                ? `Start every remaining step at once, ${MAX_FANOUT} at a time`
                : 'Run every remaining step, in order'
            }
            className="rounded bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-fg hover:bg-surface-2 disabled:opacity-40"
          >
            {running
              ? 'running…'
              : `approve ${pending === plan.steps.length ? 'plan' : 'rest'}${parallel ? ' ⇉' : ''}`}
          </button>
        )}
        <button
          onClick={discard}
          disabled={running}
          title={live ? 'Throw the plan away' : 'Clear it from the canvas'}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg-muted disabled:opacity-40"
        >
          <X size={9} />
          {live ? 'discard' : 'clear'}
        </button>
        <span
          className="ml-auto shrink-0 truncate font-mono text-[9px] text-fg-faint"
          title={shape.cost}
        >
          {parallel ? 'runs at once' : 'runs in order'}
        </span>
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
