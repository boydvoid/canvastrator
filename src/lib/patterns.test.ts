import { describe, expect, it } from 'vitest'
import {
  checkShape,
  fansOut,
  MAX_FANOUT,
  parsePattern,
  PATTERNS,
  pattern,
  toPatternId,
} from './patterns'
import { parsePlan } from './plan'

describe('the ladder', () => {
  it('is ordered cheapest first, with no rung repeated', () => {
    const rungs = PATTERNS.map((p) => p.rung)
    expect(rungs).toEqual([...rungs].sort((a, b) => a - b))
    expect(new Set(rungs).size).toBe(rungs.length)
  })

  it('fans out for exactly one shape — the one whose steps do not read each other', () => {
    expect(PATTERNS.filter((p) => p.run === 'fanout').map((p) => p.id)).toEqual(['parallel'])
    expect(fansOut('parallel')).toBe(true)
    expect(fansOut('chain')).toBe(false)
    // A plan with no declared shape runs in order, which is the safe reading.
    expect(fansOut(undefined)).toBe(false)
  })

  it('looks up by id', () => {
    expect(pattern('evaluate').name).toBe('evaluator-optimizer')
  })
})

describe('toPatternId', () => {
  it('takes the ids the app uses', () => {
    expect(toPatternId('parallel')).toBe('parallel')
    expect(toPatternId('  ORCHESTRATE ')).toBe('orchestrate')
  })

  it('takes the names the literature uses, since that is what a model reaches for', () => {
    expect(toPatternId('parallelization')).toBe('parallel')
    expect(toPatternId('orchestrator-worker')).toBe('orchestrate')
    expect(toPatternId('prompt chaining')).toBe('chain')
    expect(toPatternId('single_agent_loop')).toBe('single')
    expect(toPatternId('evaluator-optimiser')).toBe('evaluate')
  })

  it('refuses anything else rather than guessing', () => {
    expect(toPatternId('swarm')).toBeNull()
    expect(toPatternId('')).toBeNull()
  })
})

describe('parsePattern', () => {
  it('reads the declaration and the reason', () => {
    expect(parsePattern('PATTERN chain: each step needs the last one’s output.')).toEqual({
      id: 'chain',
      why: 'each step needs the last one’s output.',
    })
  })

  it('finds it under commentary, since models preamble', () => {
    const reply = "Here's how I'd shape this.\n\nPATTERN parallel: the three reviews are independent.\n\nPLAN reviewer: check the auth path"
    expect(parsePattern(reply)?.id).toBe('parallel')
  })

  it('takes the opening declaration when a reply names two', () => {
    const reply = 'PATTERN single: one agent can hold this.\nPATTERN parallel: actually four.'
    expect(parsePattern(reply)?.id).toBe('single')
  })

  it('is nothing when the shape is unknown, rather than a default', () => {
    expect(parsePattern('PATTERN swarm: fifty agents')).toBeNull()
    expect(parsePattern('PATTERN parallel')).toBeNull()
    expect(parsePattern('PATTERN parallel:   ')).toBeNull()
    expect(parsePattern('no pattern here')).toBeNull()
  })

  it('does not become a plan step', () => {
    const reply = 'PATTERN parallel: independent\nPLAN reviewer: read src/lib'
    expect(parsePlan(reply)).toEqual([{ persona: 'reviewer', task: 'read src/lib' }])
  })
})

describe('checkShape', () => {
  it('passes a plan whose length matches what it claimed', () => {
    expect(checkShape('single', 1)).toBeNull()
    expect(checkShape('parallel', 4)).toBeNull()
    expect(checkShape('chain', 2)).toBeNull()
  })

  it('catches the expensive direction — a one-agent shape with a squad under it', () => {
    const complaint = checkShape('single', 4)
    expect(complaint).toBeTruthy()
    expect(complaint).toContain('4 steps')
  })

  it('catches the empty direction — a shape that needs several with only one', () => {
    expect(checkShape('parallel', 1)).toBeTruthy()
    expect(checkShape('evaluate', 1)).toBeTruthy()
  })

  it('lets the shapes with no ceiling grow, since that is what they are for', () => {
    expect(checkShape('orchestrate', 9)).toBeNull()
    expect(checkShape('chain', 9)).toBeNull()
  })

  it('leaves routing at one specialist, the whole point of routing', () => {
    expect(checkShape('route', 1)).toBeNull()
    expect(checkShape('route', 3)).toBeTruthy()
  })
})

describe('the fan-out cap', () => {
  it('is small enough to bound a wave and big enough to be worth having', () => {
    expect(MAX_FANOUT).toBeGreaterThanOrEqual(2)
    expect(MAX_FANOUT).toBeLessThanOrEqual(6)
  })

  it('does not cap the plan itself — a wider plan runs in waves, it is not truncated', () => {
    expect(checkShape('parallel', MAX_FANOUT + 4)).toBeNull()
  })
})
