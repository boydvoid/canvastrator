/**
 * How a job should be shaped before anyone starts it.
 *
 * A canvas of agents makes fan-out the easy move, and that is exactly the
 * trap: a squad of workers can spend an order of magnitude more tokens than
 * one agent doing the same job alone, and every extra agent is another context
 * window to fill, another reply to read, and another thing that can fail
 * halfway. So the orchestrator is made to name the shape first, cheapest one
 * that fits, and say why the rung above it would not do.
 *
 * The six shapes are a ladder, not a menu. Rung 1 is one agent in a loop with
 * its tools; each rung down buys a capability — a fixed decomposition, a
 * classifier, real concurrency, runtime decomposition, a critic — and pays for
 * it in tokens and coordination. Escalation is only justified by a capability
 * gap: the work does not fit one context window, or the subtasks are genuinely
 * independent, or quality is measurable and improves under critique.
 *
 * Canvastrator reads the declared shape rather than only displaying it: a plan
 * that says its steps are independent is run as a fan-out, and one that says
 * they build on each other is run in order. That is the whole point of asking
 * for the shape — a recommendation nothing acts on is a comment.
 */

export type PatternId = 'single' | 'chain' | 'route' | 'parallel' | 'orchestrate' | 'evaluate'

export type Pattern = {
  id: PatternId
  /** The name it goes by outside this app, so the two can be recognised as one thing. */
  name: string
  /** Its rung on the ladder. 1 is the cheapest thing that can work. */
  rung: number
  /** Roughly what it costs against one agent doing the job alone. */
  cost: string
  /** When it is the right answer. */
  fit: string
  /** When it is the wrong one — the half that usually goes unsaid. */
  avoid: string
  /** How Canvastrator runs a plan that declares it. */
  run: 'one' | 'sequence' | 'fanout'
  /**
   * How many steps a plan of this shape can honestly have.
   *
   * A shape is a claim about the work, and the step count is that claim in
   * numbers: "one agent can hold this" and four steps cannot both be true.
   * `null` for no upper bound. This is what turns the declaration from a label
   * into something that can be wrong — and being able to be wrong is the only
   * reason asking for it does any work.
   */
  steps: { min: number; max: number | null }
}

export const PATTERNS: Pattern[] = [
  {
    id: 'single',
    name: 'single-agent loop',
    rung: 1,
    cost: 'baseline',
    fit: 'the job fits in one agent\'s context and it has the tools to finish it',
    avoid: 'independent subtasks that would genuinely gain from running at once',
    run: 'one',
    steps: { min: 1, max: 1 },
  },
  {
    id: 'chain',
    name: 'prompt chaining',
    rung: 2,
    cost: 'one agent per step, fixed by the length of the chain',
    fit: 'the steps are known now and each one works on what the last one produced',
    avoid: 'the steps are not knowable until something has run',
    run: 'sequence',
    steps: { min: 2, max: null },
  },
  {
    id: 'route',
    name: 'routing',
    rung: 3,
    cost: 'a classification, then one specialist',
    fit: 'the request falls into distinct kinds that are better handled by different specialists',
    avoid: 'every request would be handled the same way anyway',
    run: 'one',
    steps: { min: 1, max: 1 },
  },
  {
    id: 'parallel',
    name: 'parallelisation',
    rung: 4,
    cost: 'multiplied by the width of the fan-out',
    fit: 'the subtasks are known now, do not read each other\'s output, and are worth running at once — or several views of one question raise confidence',
    avoid: 'the steps depend on each other, or they need one shared, evolving context',
    run: 'fanout',
    steps: { min: 2, max: null },
  },
  {
    id: 'orchestrate',
    name: 'orchestrator-worker',
    rung: 5,
    cost: 'multiplied by the number of workers, and unknown until it runs',
    fit: 'what the subtasks even are cannot be settled until some of the work has been done',
    avoid: 'the subtasks are predictable — then a chain or a fan-out does it for less',
    run: 'sequence',
    steps: { min: 1, max: null },
  },
  {
    id: 'evaluate',
    name: 'evaluator-optimizer',
    rung: 6,
    cost: 'one agent per revision cycle, until the bar is met',
    fit: 'there is a stated bar to meet, and the work measurably improves when it is criticised',
    avoid: 'the first attempt already clears the bar, or nobody can say what "good" is here',
    run: 'sequence',
    steps: { min: 2, max: null },
  },
]

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]))

export const pattern = (id: PatternId): Pattern => BY_ID.get(id)!

/**
 * The names these shapes are known by elsewhere.
 *
 * The models being orchestrated have read the same literature the ladder came
 * from, so they reach for its words — "parallelization", "orchestrator-worker"
 * — rather than the short ids this app uses. Refusing those spellings would
 * throw away a correct decision over a synonym, which is the least defensible
 * possible reason to lose one.
 */
const ALIASES: Record<string, PatternId> = {
  'single-agent': 'single',
  'single-agent-loop': 'single',
  loop: 'single',
  'prompt-chaining': 'chain',
  chaining: 'chain',
  chained: 'chain',
  routing: 'route',
  router: 'route',
  parallelisation: 'parallel',
  parallelization: 'parallel',
  'fan-out': 'parallel',
  fanout: 'parallel',
  'orchestrator-worker': 'orchestrate',
  'orchestrator-workers': 'orchestrate',
  worker: 'orchestrate',
  'evaluator-optimizer': 'evaluate',
  'evaluator-optimiser': 'evaluate',
  evaluator: 'evaluate',
}

/** A written id, in whatever spelling, as one of the six — or null. */
export function toPatternId(raw: string): PatternId | null {
  const key = raw.trim().toLowerCase().replace(/[_\s]+/g, '-')
  if (BY_ID.has(key as PatternId)) return key as PatternId
  return ALIASES[key] ?? null
}

export type PatternChoice = { id: PatternId; why: string }

/**
 * The shape the orchestrator chose, read off its reply.
 *
 * One line, before the plan, of the form `PATTERN <id>: <why>`. The first one
 * wins — unlike a plan, which accumulates, a reply that names two shapes has
 * changed its mind mid-sentence and the opening declaration is the one the
 * steps beneath it were written under. An unrecognised id is not a shape, and
 * silently defaulting it to something would put the app's guess behind the
 * orchestrator's name.
 */
export function parsePattern(text: string): PatternChoice | null {
  const m = text.match(/^[ \t]*PATTERN[ \t]+([\w-]+)[ \t]*:[ \t]*(\S[^\n]*?)[ \t]*$/im)
  if (!m) return null
  const id = toPatternId(m[1])
  return id ? { id, why: m[2].trim() } : null
}

/** Whether a plan of this shape may run its steps at once. */
export const fansOut = (id: PatternId | undefined) => !!id && pattern(id).run === 'fanout'

/**
 * How many agents may be in flight at once for one plan.
 *
 * Concurrency is the one thing a fan-out buys, and past a handful it stops
 * buying much: four agents already saturate a provider's patience, and the
 * user is paying for every one of them from the moment they start. A wider
 * plan still runs every step — it runs them in waves of this many — so the
 * cap bounds the spend rate and the blast radius without quietly dropping
 * work the user approved.
 */
export const MAX_FANOUT = 4

/**
 * Where the declared shape and the written plan disagree.
 *
 * The shape is the orchestrator's claim about the work; the steps are what it
 * actually wrote. When they contradict each other one of them is wrong, and
 * the expensive direction is always the same — a job called "parallel" that is
 * really a sequence runs four agents against the same stale state, and a job
 * called "single" with four steps has already decided to spend four times what
 * it said it would. Returns the complaint, or null when they agree.
 */
export function checkShape(id: PatternId, count: number): string | null {
  const p = pattern(id)
  if (count < p.steps.min) {
    return `Declared ${p.name} but wrote ${count} step${count === 1 ? '' : 's'} — that shape needs at least ${p.steps.min}. Running it in order.`
  }
  if (p.steps.max !== null && count > p.steps.max) {
    return `Declared ${p.name}, which is ${p.steps.max === 1 ? 'one agent' : `${p.steps.max} agents`}, but wrote ${count} steps. Either the shape is wrong or the plan is — running it in order, one step at a time.`
  }
  return null
}

const count = (p: Pattern) =>
  p.steps.max === p.steps.min
    ? `exactly ${p.steps.min} step`
    : `${p.steps.min} or more steps`

const line = (p: Pattern) =>
  `${p.rung}. ${p.id} (${p.name}, ${p.cost}, ${count(p)}) — ${p.fit}. Not this one when ${p.avoid}.`

/**
 * The part of the orchestrator's brief that makes it choose before it plans.
 *
 * Written as a ladder with the cost of each rung stated, because the failure
 * this is here to prevent is not "picked the wrong pattern" — it is reaching
 * for a squad on a job one agent could have finished, which costs real money
 * and reads as thoroughness.
 */
export function patternBlock(planning: boolean): string {
  const write = planning ? 'PLAN' : 'SPAWN'
  return [
    'Before anything else, decide what SHAPE this job has. These six are a ladder, cheapest first:',
    '',
    ...PATTERNS.map(line),
    '',
    'Take the first rung that genuinely fits, and go lower only for a capability the rung above cannot give you — the work does not fit one agent\'s context, or the subtasks truly do not read each other\'s output, or there is a stated bar that criticism measurably moves. Every rung down multiplies what this costs: a wide fan-out can spend fifteen times what a single agent spends on the same job, and an agent you did not need is one more reply to read and one more thing to go wrong.',
    '',
    'ONE AGENT IS THE DEFAULT. Every agent past the first has to earn its place, and the PATTERN line is where you say what it earned — name the capability the cheaper rung could not give you. In particular:',
    '- Do not add a reviewer, checker, or second opinion that the user did not ask for. If the work needs checking, say so and let them decide.',
    '- Do not split one coherent job across agents to look thorough. Reading three files is one agent\'s work, not three.',
    '- Do not fan out to "cover the angles" on a question that has one answer.',
    `- Anything you can answer from this conversation — what the plan says, what a result meant, what you would do next — you answer. Do not write a ${write} for it.`,
    '',
    'Open your reply with exactly this line, before anything else:',
    'PATTERN <id>: <one sentence: why this shape, and why not the cheaper rung above it>',
    '',
    `Then write the ${write} lines that shape calls for. Canvastrator runs the plan the way the shape says: steps of a "parallel" plan all start at once and report back together, and every other shape runs one step at a time, in order, each seeing what the last one produced. So do not declare "parallel" for work that has to be sequenced — the steps really will run at the same time, against the same state.`,
    '',
    `The step count in each rung above is checked, not decorative: a plan whose shape and length contradict each other is run in order regardless of what it declared, because in-order is the reading that cannot be expensive by mistake. A fan-out wider than ${MAX_FANOUT} runs in waves of ${MAX_FANOUT} rather than all at once.`,
    '',
    'A single-agent job is still one step handed to one specialist, not something you do yourself.',
  ].join('\n')
}
