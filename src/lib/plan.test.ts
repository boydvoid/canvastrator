import { describe, expect, it } from 'vitest'
import { nextStep, parsePlan, planLive, planSettled } from './plan'
import type { PlanStep } from './types'

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
