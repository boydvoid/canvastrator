import { checkShape, fansOut, pattern } from './patterns'
import type { Plan, PlanStep } from './types'

/**
 * A plan is what the orchestrator writes instead of acting, when planning is
 * on: one line per step, in the order they should run.
 *
 *   PLAN investigator: Find where the export path is implemented
 *   PLAN implementer: Add the export button to the toolbar
 *
 * SPAWN counts as a step too. The orchestrator is told to write PLAN while
 * planning is on, but an agent that reaches for the protocol it knows must not
 * get to bypass the gate by using the older word — the gate is the app's, not
 * the model's, and reading a SPAWN as a step is what makes it one.
 *
 * A step is a single line, unlike SPAWN's run-to-the-end-of-the-reply task. A
 * plan is several steps in one reply, so there has to be something that ends
 * one and starts the next, and a line is the only boundary the model can be
 * relied on to produce.
 */
const STEP = /^[ \t]*(?:PLAN|SPAWN)[ \t]+([\w.-]+)[ \t]*:[ \t]*(\S[^\n]*?)[ \t]*$/gim

export function parsePlan(text: string): Array<{ persona: string; task: string }> {
  // Fresh lastIndex per call: a module-level /g regex remembers where it got to.
  STEP.lastIndex = 0
  const steps: Array<{ persona: string; task: string }> = []
  for (const m of text.matchAll(STEP)) steps.push({ persona: m[1], task: m[2].trim() })
  return steps
}

/** Nothing left to approve — every step has run, one way or the other. */
export const planSettled = (steps: PlanStep[]) =>
  steps.every((s) => s.state === 'done' || s.state === 'failed')

/** The next step to run: the first one still waiting. */
export const nextStep = (steps: PlanStep[]) => steps.find((s) => s.state === 'pending')

/** A plan is only worth showing while something can still come of it. */
export const planLive = (steps: PlanStep[]) => steps.length > 0 && !planSettled(steps)

/**
 * How long a plan may get.
 *
 * The orchestrator writes again after every step reports back, and nothing in
 * that loop ends it on its own — an agent asked to critique its own plan will
 * happily keep finding one more thing. The ceiling is the app's, not the
 * model's, and it bounds a plan grown by hand for the same reason.
 */
export const MAX_PLAN_STEPS = 24

/**
 * Whether a step says enough to be run.
 *
 * A step you added starts blank — a slot in the order with nothing in it yet —
 * and the persona is what decides which agent it becomes. Running one of these
 * would spawn an agent with no name and no task, which is a way of failing
 * that looks like the app's fault rather than an empty field.
 */
export const stepReady = (s: PlanStep) => s.persona.trim() !== '' && s.task.trim() !== ''

/**
 * Where a step of your own may go.
 *
 * Slot `i` puts a step before the step now at `i`; the slot at the end appends.
 * They stop at the first step still pending, because everything above it has
 * already started and its position is history — inserting "before" a step that
 * ran an hour ago would be a promise the running order cannot keep.
 */
export function addSlots(steps: PlanStep[]): number[] {
  if (steps.length >= MAX_PLAN_STEPS) return []
  const first = steps.findIndex((s) => s.state === 'pending')
  if (first < 0) return []
  const slots: number[] = []
  for (let i = first; i <= steps.length; i++) slots.push(i)
  return slots
}

/**
 * Put a step of your own into the plan.
 *
 * It lands blank and pending: the plan is a list of things that have not
 * happened, and one you wrote yourself is no different except in who wrote it.
 * Returns the new plan, or null when there is no room left.
 *
 * The shape the orchestrator declared is a claim about the work — "one agent,
 * start to finish" — and a step you add can make that claim untrue. That is
 * not the orchestrator going back on its word, so the card says who changed
 * it, but the consequence is the one the app already applies to a plan that
 * outgrew its shape: it runs in order, one step at a time.
 *
 * Order is the whole point of placing a step. A reviewer goes *before* the
 * implementer, and a fan-out would start both at once and make that position
 * mean nothing — so a plan edited by hand stops fanning out whether or not its
 * shape still fits.
 */
export function insertStep(plan: Plan, at: number, id: string): Plan | null {
  if (plan.steps.length >= MAX_PLAN_STEPS) return null
  const where = Math.max(0, Math.min(at, plan.steps.length))
  const steps = [
    ...plan.steps.slice(0, where),
    { id, persona: '', task: '', state: 'pending' as const },
    ...plan.steps.slice(where),
  ]
  return { ...plan, steps, ...byHand(plan, steps.length) }
}

/** The note the card carries once a plan has a step in it that you placed. */
function byHand(plan: Plan, count: number): { warning?: string } {
  if (!plan.pattern) return {}
  const shape = pattern(plan.pattern.id)
  if (checkShape(plan.pattern.id, count)) {
    return {
      warning: `You added a step, so this is no longer ${shape.name} — running it in order, one step at a time.`,
    }
  }
  if (fansOut(plan.pattern.id)) {
    return {
      warning: `You added a step, and a fan-out starts every step at once — which would make where you put it mean nothing. Running this one in order instead.`,
    }
  }
  return {}
}

/**
 * How many plans one orchestrator may have in flight at once.
 *
 * Parallel repairs are the point of holding more than one, and this is not a
 * limit anyone should meet by working normally — it is a backstop on the app
 * mistaking every hand-back for a fresh ask and quietly filling the canvas
 * with tracks nobody opened.
 */
export const MAX_PLANS = 6

/** The agents whose reports a turn carried back, if it carried any. */
export function reportedBy(text: string): string[] {
  return [...text.matchAll(/<canvastrator-report from="([^"]*)"/g)].map((m) => m[1])
}

/**
 * The plan a reply is adding to, or null when it is starting a new one.
 *
 * This is what separates the orchestrator writing *more of a plan* from the
 * orchestrator answering something new, and the evidence is the turn it is
 * replying to. A step that ran hands its worker's report back as the next
 * turn, so a reply to a report belongs to the plan that worker came from —
 * that is the orchestrator-worker loop the shapes are built around, and the
 * steps already approved are part of the same job.
 *
 * Anything else is a new plan. Asking for a second fix while the first is
 * still running is a second job, and it used to have nowhere to go: the steps
 * went onto the end of whatever plan was live, under a shape chosen for a
 * different question.
 *
 * `nameOf` resolves a step's child to the name it reports under, which is the
 * only thing the report carries. Passed in because this has no business
 * knowing what a canvas node is.
 */
export function planOfReply(
  plans: Plan[],
  fromNodeId: string,
  incoming: string,
  nameOf: (childId: string) => string | undefined,
): Plan | null {
  const reporters = new Set(reportedBy(incoming))
  if (!reporters.size) return null
  return (
    plans.find(
      (p) =>
        p.fromNodeId === fromNodeId &&
        p.steps.some((st) => {
          const name = st.childId && nameOf(st.childId)
          return !!name && reporters.has(name)
        }),
    ) ?? null
  )
}

/** The plan holding a step, and the step itself, wherever they live. */
export function findStep(
  plans: Plan[],
  stepId: string,
): { plan: Plan; step: PlanStep } | null {
  for (const plan of plans) {
    const step = plan.steps.find((s) => s.id === stepId)
    if (step) return { plan, step }
  }
  return null
}

/**
 * Replace one plan, dropping it when the change leaves nothing behind.
 *
 * Every edit to a plan goes through here so that "a plan with no steps left is
 * not a plan" is written once rather than at each call site that can empty one.
 */
export function withPlan(plans: Plan[], planId: string, fn: (p: Plan) => Plan | null): Plan[] {
  const out: Plan[] = []
  for (const p of plans) {
    if (p.id !== planId) {
      out.push(p)
      continue
    }
    const next = fn(p)
    if (next && next.steps.length) out.push(next)
  }
  return out
}
