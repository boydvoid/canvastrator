/**
 * The plan, in the words someone would use out loud.
 *
 * The card used to open with `SHAPE` and `single` — two labels, neither of
 * which answers the question being asked at that moment, which is: what is
 * about to happen, and how much of it. "single" is an id from a taxonomy;
 * "one agent, start to finish" is the same fact in a form nobody has to learn.
 *
 * The taxonomy is still right and still worth keeping — it is how the patterns
 * are named in the literature the orchestrator was taught from, and a user who
 * knows it should see it. It just belongs in a footnote rather than a headline.
 */
import type { PatternId } from './patterns'

/**
 * One line: how many agents, and how they run.
 *
 * The count comes from the plan rather than the pattern, because the pattern
 * says what shape the work has and only the plan knows how wide it turned out.
 */
export function planSentence(id: PatternId | undefined, steps: number): string {
  const n = Math.max(steps, 0)
  const agents = `${n} agent${n === 1 ? '' : 's'}`

  switch (id) {
    case 'single':
      // A single-agent plan of several steps is still one agent: the shape is
      // about who does the work, not how many boxes it was written in.
      return n <= 1 ? 'One agent, start to finish' : `One agent, ${n} steps in order`
    case 'chain':
      return `${agents}, each picking up where the last left off`
    case 'route':
      return n <= 1 ? 'One specialist, chosen for the job' : `One of ${n} specialists, chosen for the job`
    case 'parallel':
      return `${agents}, running at once`
    case 'orchestrate':
      return `${agents}, reporting back as they finish`
    case 'evaluate':
      return n <= 1 ? 'One agent, checked and revised' : `${agents}, making and checking each other`
    default:
      // No shape declared. The plan still runs — in order, the safe reading —
      // and saying so beats a card that says "unknown".
      return `${agents}, ${n === 1 ? 'one step' : 'in order'}`
  }
}

/**
 * What the button will do, spelled out.
 *
 * `approve plan` describes the user's act; this describes the consequence,
 * which is the thing worth reading before clicking. It also has to be honest
 * about *at once* versus *in order* — a fan-out the app demoted to sequential
 * must not promise a parallel start it will not make.
 */
export function runLabel(pending: number, total: number, atOnce: boolean): string {
  if (pending <= 0) return 'Nothing left to run'
  const how = atOnce && pending > 1 ? 'at once' : 'in order'
  // "the rest" once some of it has already run: "Run all 3" would be a lie
  // about a plan that is two thirds done.
  if (pending < total) return pending === 1 ? 'Run the last step' : `Run the remaining ${pending} ${how}`
  if (total === 1) return 'Run it'
  return `Run all ${total} ${how}`
}

/** `step 2 of 3` while it is going, `3 steps` before it starts. */
export function progressLabel(at: number, total: number): string {
  if (at > 0) return `step ${at} of ${total}`
  return `${total} step${total === 1 ? '' : 's'}`
}
