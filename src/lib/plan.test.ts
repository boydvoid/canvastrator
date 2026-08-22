import { describe, expect, it } from 'vitest'
import {
  addSlots,
  insertStep,
  MAX_PLAN_STEPS,
  nextStep,
  parsePlan,
  findStep,
  planLive,
  planOfReply,
  planSettled,
  reportedBy,
  stepReady,
  withPlan,
} from './plan'
import type { Plan, PlanStep } from './types'

const step = (id: string, state: PlanStep['state']): PlanStep => ({
  id,
  persona: 'implementer',
  task: 'do the thing',
  state,
})

describe('parsePlan', () => {
  it('reads a step per line, in order', () => {
    const steps = parsePlan(
      [
        "Here's how I'd approach it.",
        '',
        'PLAN investigator: Find where the export path is implemented',
        'PLAN implementer: Add the export button to the toolbar',
        'PLAN reviewer: Check the change against the export contract',
      ].join('\n'),
    )
    expect(steps.map((s) => s.persona)).toEqual(['investigator', 'implementer', 'reviewer'])
    expect(steps[0].task).toBe('Find where the export path is implemented')
  })

  /** The gate is the app's, so the older protocol must not walk around it. */
  it('counts a SPAWN line as a step', () => {
    const steps = parsePlan('SPAWN reviewer: Check the diff')
    expect(steps).toEqual([{ persona: 'reviewer', task: 'Check the diff' }])
  })

  it('ignores prose that merely mentions the protocol', () => {
    expect(parsePlan('I would plan: first look, then write.')).toEqual([])
    expect(parsePlan('The plan is to spawn a reviewer afterwards.')).toEqual([])
  })

  it('takes the keyword in any case, and trims the task', () => {
    expect(parsePlan('plan   Reviewer :   check it   ')).toEqual([
      { persona: 'Reviewer', task: 'check it' },
    ])
  })

  it('skips a step with no task', () => {
    expect(parsePlan('PLAN reviewer:\nPLAN implementer: write it')).toEqual([
      { persona: 'implementer', task: 'write it' },
    ])
  })

  it('stops a step at its own line', () => {
    const steps = parsePlan('PLAN a: first\nPLAN b: second\n\nThat should cover it.')
    expect(steps.map((s) => s.task)).toEqual(['first', 'second'])
  })

  /** A module-level /g regex remembers where it got to; this would return
   *  nothing the second time round if lastIndex weren't reset. */
  it('gives the same answer twice', () => {
    const text = 'PLAN a: first\nPLAN b: second'
    expect(parsePlan(text)).toEqual(parsePlan(text))
    expect(parsePlan(text)).toHaveLength(2)
  })

  it('handles an empty reply', () => {
    expect(parsePlan('')).toEqual([])
  })
})

describe('plan state', () => {
  it('is settled only when nothing is left to run', () => {
    expect(planSettled([step('1', 'done'), step('2', 'failed')])).toBe(true)
    expect(planSettled([step('1', 'done'), step('2', 'pending')])).toBe(false)
    expect(planSettled([step('1', 'running')])).toBe(false)
  })

  it('runs the first step still waiting', () => {
    const steps = [step('1', 'done'), step('2', 'pending'), step('3', 'pending')]
    expect(nextStep(steps)?.id).toBe('2')
    expect(nextStep([step('1', 'done')])).toBeUndefined()
  })

  it('is live while something can still come of it', () => {
    expect(planLive([])).toBe(false)
    expect(planLive([step('1', 'done')])).toBe(false)
    expect(planLive([step('1', 'done'), step('2', 'pending')])).toBe(true)
  })
})

const plan = (steps: PlanStep[], pattern?: Plan['pattern']): Plan => ({
  id: 'plan_1',
  fromNodeId: 'orc',
  goal: 'do the thing',
  steps,
  proposedAt: 0,
  ...(pattern ? { pattern } : {}),
})

describe('stepReady', () => {
  it('wants both a persona and a task', () => {
    expect(stepReady(step('a', 'pending'))).toBe(true)
    expect(stepReady({ ...step('a', 'pending'), persona: '' })).toBe(false)
    expect(stepReady({ ...step('a', 'pending'), task: '' })).toBe(false)
    // Whitespace is not an answer to either question.
    expect(stepReady({ ...step('a', 'pending'), task: '   ' })).toBe(false)
  })
})

describe('addSlots', () => {
  it('offers a slot before every step and one at the end', () => {
    expect(addSlots([step('a', 'pending'), step('b', 'pending')])).toEqual([0, 1, 2])
  })

  it('starts at the first step still pending, since the rest is history', () => {
    const steps = [step('a', 'done'), step('b', 'running'), step('c', 'pending')]
    expect(addSlots(steps)).toEqual([2, 3])
  })

  it('offers nothing once every step has run', () => {
    expect(addSlots([step('a', 'done'), step('b', 'failed')])).toEqual([])
    expect(addSlots([])).toEqual([])
  })

  it('offers nothing at the ceiling', () => {
    const full = Array.from({ length: MAX_PLAN_STEPS }, (_, i) => step(`s${i}`, 'pending'))
    expect(addSlots(full)).toEqual([])
  })
})

describe('insertStep', () => {
  it('puts a blank pending step where you asked for it', () => {
    const out = insertStep(plan([step('a', 'pending'), step('b', 'pending')]), 1, 'new')
    expect(out?.steps.map((s) => s.id)).toEqual(['a', 'new', 'b'])
    expect(out?.steps[1]).toMatchObject({ persona: '', task: '', state: 'pending' })
  })

  it('appends past the end and clamps below the start', () => {
    const one = plan([step('a', 'pending')])
    expect(insertStep(one, 99, 'new')?.steps.map((s) => s.id)).toEqual(['a', 'new'])
    expect(insertStep(one, -4, 'new')?.steps.map((s) => s.id)).toEqual(['new', 'a'])
  })

  it('leaves the steps already there untouched', () => {
    const before = plan([step('a', 'done')])
    const out = insertStep(before, 1, 'new')
    expect(out?.steps[0]).toBe(before.steps[0])
    expect(before.steps).toHaveLength(1)
  })

  it('refuses to grow a plan past the ceiling', () => {
    const full = plan(Array.from({ length: MAX_PLAN_STEPS }, (_, i) => step(`s${i}`, 'pending')))
    expect(insertStep(full, 0, 'new')).toBeNull()
  })

  it('says so when your step breaks the shape that was declared', () => {
    const out = insertStep(plan([step('a', 'pending')], { id: 'single', why: 'small job' }), 1, 'new')
    expect(out?.warning).toMatch(/no longer/)
    expect(out?.warning).toMatch(/in order/)
  })

  it('stops a fan-out, because a position means nothing when everything starts at once', () => {
    const wide = plan(
      [step('a', 'pending'), step('b', 'pending')],
      { id: 'parallel', why: 'independent' },
    )
    expect(insertStep(wide, 1, 'new')?.warning).toMatch(/in order/)
  })

  it('says nothing about a plan your step still fits', () => {
    const chain = plan([step('a', 'pending'), step('b', 'pending')], { id: 'chain', why: 'builds up' })
    expect(insertStep(chain, 1, 'new')?.warning).toBeUndefined()
  })

  it('keeps a warning the plan already carried', () => {
    const chain = plan([step('a', 'pending')], { id: 'chain', why: 'builds up' })
    const out = insertStep({ ...chain, warning: 'said before' }, 1, 'new')
    expect(out?.warning).toBe('said before')
  })
})

describe('planOfReply', () => {
  const report = (name: string) =>
    `<canvastrator-report from="${name}">\n${name} reported:\n\ndone\n</canvastrator-report>`
  const ran = (id: string, childId: string): PlanStep => ({
    id,
    persona: 'implementer',
    task: 'go',
    state: 'done',
    childId,
  })
  const names: Record<string, string> = { kid1: 'implementer-1', kid2: 'reviewer-2' }
  const nameOf = (id: string) => names[id]

  it('adds to the plan whose worker just reported back', () => {
    const first = { ...plan([ran('s1', 'kid1')]), id: 'p1' }
    const second = { ...plan([ran('s2', 'kid2')]), id: 'p2' }
    expect(planOfReply([first, second], 'orc', report('reviewer-2'), nameOf)?.id).toBe('p2')
  })

  /** The case that used to pile a second job onto the end of the first. */
  it('starts a new plan for a reply that is not answering a report', () => {
    const live = { ...plan([ran('s1', 'kid1')]), id: 'p1' }
    expect(planOfReply([live], 'orc', 'Also fix the import path please', nameOf)).toBeNull()
  })

  it('starts a new plan when the reporter belongs to no plan of this agent', () => {
    const live = { ...plan([ran('s1', 'kid1')]), id: 'p1' }
    // A delegate's hand-back, or a worker whose step has been dropped.
    expect(planOfReply([live], 'orc', report('someone-else'), nameOf)).toBeNull()
    // The right worker, but another orchestrator's plan.
    expect(planOfReply([{ ...live, fromNodeId: 'other' }], 'orc', report('implementer-1'), nameOf)).toBeNull()
  })

  it('reads every reporter in a fan-out that handed back together', () => {
    const wide = { ...plan([ran('s1', 'kid1'), ran('s2', 'kid2')]), id: 'p1' }
    const both = `${report('implementer-1')}\n\n${report('reviewer-2')}`
    expect(planOfReply([wide], 'orc', both, nameOf)?.id).toBe('p1')
    expect(reportedBy(both)).toEqual(['implementer-1', 'reviewer-2'])
  })
})

describe('withPlan', () => {
  const a = { ...plan([step('s1', 'pending')]), id: 'a' }
  const b = { ...plan([step('s2', 'pending')]), id: 'b' }

  it('replaces one plan and leaves the others alone', () => {
    const out = withPlan([a, b], 'b', (p) => ({ ...p, goal: 'changed' }))
    expect(out.map((p) => p.goal)).toEqual(['do the thing', 'changed'])
    expect(out[0]).toBe(a)
  })

  it('drops a plan an edit emptied, since a plan with no steps is not one', () => {
    expect(withPlan([a, b], 'a', (p) => ({ ...p, steps: [] })).map((p) => p.id)).toEqual(['b'])
    expect(withPlan([a, b], 'a', () => null).map((p) => p.id)).toEqual(['b'])
  })
})

describe('findStep', () => {
  it('finds a step in whichever plan is holding it', () => {
    const a = { ...plan([step('s1', 'pending')]), id: 'a' }
    const b = { ...plan([step('s2', 'done')]), id: 'b' }
    expect(findStep([a, b], 's2')?.plan.id).toBe('b')
    expect(findStep([a, b], 's2')?.step.state).toBe('done')
    expect(findStep([a, b], 'nope')).toBeNull()
  })
})
