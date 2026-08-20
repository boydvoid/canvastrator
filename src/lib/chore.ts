/**
 * Requests that name an operation rather than a goal.
 *
 * "Push the branch" is not a task to decompose. The user has already decided
 * what happens; there is nothing to investigate, nothing to design, and the
 * whole job is one command. An orchestrator told only that its purpose is to
 * route work treats it like any other request — it picks a persona, embellishes
 * the task, and often goes looking for adjacent work to do on the way, which is
 * how "push code" turns into a subagent rewriting something nobody asked about.
 *
 * The brief cannot fix this on its own: every rule it carries is about how to
 * break work down, and a chore is the case where breaking down is the error. So
 * the app recognises the shape and says so in the turn itself.
 *
 * Deliberately conservative. Missing a chore costs one unnecessary planning
 * step; calling a piece of real work a chore tells the orchestrator not to
 * think about something that needed thinking about. When the two are in
 * tension, this errs toward missing.
 */

/**
 * Verbs that are almost never product work.
 *
 * `build`, `run` and `test` are missing on purpose — "build the settings page"
 * is a feature, and no wording test separates it from "build the app"
 * reliably. They come back below as whole phrases, where the object makes them
 * unambiguous.
 */
const VERBS = [
  'push',
  'pull',
  'commit',
  'merge',
  'rebase',
  'stash',
  'revert',
  'cherry-pick',
  'tag',
  'publish',
  'deploy',
  'rebuild',
  'reinstall',
  'restart',
  'lint',
  'typecheck',
  'format',
]

/** The ambiguous verbs, in the company that settles them. */
const PHRASES = [
  'run the tests',
  'run tests',
  'run the test suite',
  'run the suite',
  'run the build',
  'run the linter',
  'run typecheck',
  'run the typecheck',
  'build the app',
  'build it',
]

/**
 * Words that mean the request is open-ended however it starts.
 *
 * "Push the branch and fix whatever breaks" is not a chore — the second half
 * is the actual job, and it needs a plan. One of these anywhere in the request
 * is enough to disqualify it.
 */
const OPEN_ENDED = [
  'why',
  'how',
  'what',
  'investigate',
  'figure out',
  'work out',
  'diagnose',
  'debug',
  'fix',
  'review',
  'refactor',
  'design',
  'improve',
  'research',
  'explore',
  'decide',
  'plan',
]

/** Politeness that can precede the verb without changing what is being asked. */
const PREAMBLE = /^(?:ok(?:ay)?|now|please|pls|can you|could you|would you|go(?:\s+ahead\s+and)?|let's|lets|just)\b[\s,]*/i

/** Longer than this and it is not one instruction, whatever it starts with. */
const MAX_CHARS = 160

/**
 * Whether this turn is an instruction to carry out rather than work to plan.
 */
export function looksLikeChore(text: string): boolean {
  const raw = text.trim()
  if (!raw || raw.length > MAX_CHARS) return false
  // A question is a question even when it is about a command.
  if (raw.includes('?')) return false
  // More than a couple of lines is a brief, not an instruction.
  if (raw.split('\n').filter((l) => l.trim()).length > 2) return false

  const lower = raw.toLowerCase()
  if (OPEN_ENDED.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) return false

  // Strip the politeness, then look at what is actually being asked.
  let body = lower.replace(PREAMBLE, '')
  // A second layer catches "ok can you just …", which is one phrase in
  // practice and three passes here.
  body = body.replace(PREAMBLE, '').replace(PREAMBLE, '')

  if (PHRASES.some((p) => body.startsWith(p))) return true
  const first = body.split(/[\s,]+/)[0]?.replace(/[^a-z-]/g, '') ?? ''
  return VERBS.includes(first)
}

/**
 * What the orchestrator is told when the turn is a chore.
 *
 * Sent with that turn only. It is not a standing rule — the next message may
 * well be real work, and an orchestrator holding "do not decompose" as
 * permanent advice is worse than one that never heard it.
 */
export function choreBlock(planning: boolean): string {
  const write = planning ? 'PLAN' : 'SPAWN'
  return [
    '<canvastrator-chore>',
    'This turn names an operation, not a goal. The user has already decided what happens — there is nothing here to investigate, design, or improve.',
    '',
    `Exactly one ${write} step, handed to one agent, and the task is the user's own instruction. Do not restate it as a project, do not add a check, a review, a verification pass, or a follow-up nobody asked for, and do not pick up anything you noticed earlier in the conversation while you are at it.`,
    '',
    'If it fails, say what failed and stop. Fixing whatever went wrong is a decision for the user to make, not the next step of this turn.',
    '</canvastrator-chore>',
  ].join('\n')
}
