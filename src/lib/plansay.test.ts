import { describe, expect, it } from 'vitest'
import { planSentence, progressLabel, runLabel } from './plansay'

describe('planSentence', () => {
  it('says how many agents and how they run, per shape', () => {
    expect(planSentence('parallel', 3)).toBe('3 agents, running at once')
    expect(planSentence('chain', 3)).toBe('3 agents, each picking up where the last left off')
    expect(planSentence('orchestrate', 4)).toBe('4 agents, reporting back as they finish')
  })

  it('keeps a single-agent plan singular however many steps it has', () => {
    // The shape is about who does the work, not how many boxes it was written
    // in — this is the case the old card rendered as "1 steps".
    expect(planSentence('single', 1)).toBe('One agent, start to finish')
    expect(planSentence('single', 3)).toBe('One agent, 3 steps in order')
  })

  it('says routing picks one of them, which is the whole point of routing', () => {
    expect(planSentence('route', 3)).toBe('One of 3 specialists, chosen for the job')
    expect(planSentence('route', 1)).toBe('One specialist, chosen for the job')
  })

  it('still says something when no shape was declared', () => {
    expect(planSentence(undefined, 2)).toBe('2 agents, in order')
    expect(planSentence(undefined, 1)).toBe('1 agent, one step')
  })
})

describe('runLabel', () => {
  it('names the consequence, not the act', () => {
    expect(runLabel(3, 3, true)).toBe('Run all 3 at once')
    expect(runLabel(3, 3, false)).toBe('Run all 3 in order')
    expect(runLabel(1, 1, false)).toBe('Run it')
  })

  it('says "remaining" once part of the plan has run', () => {
    expect(runLabel(2, 3, false)).toBe('Run the remaining 2 in order')
    expect(runLabel(1, 3, true)).toBe('Run the last step')
  })

  it('never promises a parallel start for a single step', () => {
    // One thing cannot run "at once", and a demoted fan-out must not claim it.
    expect(runLabel(1, 1, true)).toBe('Run it')
  })

  it('has nothing to offer for a finished plan', () => {
    expect(runLabel(0, 3, true)).toBe('Nothing left to run')
  })
})

describe('progressLabel', () => {
  it('counts steps before the plan starts, and position after', () => {
    expect(progressLabel(0, 3)).toBe('3 steps')
    expect(progressLabel(2, 3)).toBe('step 2 of 3')
  })

  it('gets the singular right', () => {
    // The bug that made the whole card look careless.
    expect(progressLabel(0, 1)).toBe('1 step')
  })
})
