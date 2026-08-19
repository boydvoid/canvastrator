import type { PlanStep } from './types'

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
