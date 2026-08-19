import { describe, expect, it } from 'vitest'
import { planFlow, planNodeId, PLAN_STEP_SIZE } from './plannodes'
import type { GtNode } from './store'
import type { Plan, PlanStep } from './types'

const orchestrator = (id = 'orc', x = 0, y = 0): GtNode => ({
  id,
  type: 'session',
  position: { x, y },
  width: 260,
  data: {
    sessionId: `s_${id}`,
    provider: 'claude',
    role: 'orchestrator',
    name: id,
    cwd: '',
    state: 'idle',
    permission: 'auto',
    messages: [],
    usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    skillIds: [],
  },
})

/** A spawned agent is the same shape as any other session node. */
const child = (id: string): GtNode => orchestrator(id)

const step = (id: string, over: Partial<PlanStep> = {}): PlanStep => ({
  id,
  persona: 'reviewer',
  task: 'check it',
  state: 'pending',
  ...over,
})

const plan = (steps: PlanStep[], fromNodeId = 'orc'): Plan => ({
  fromNodeId,
  goal: 'do the thing',
  steps,
  proposedAt: 0,
})

describe('planFlow', () => {
  it('makes one node per step', () => {
    const out = planFlow(plan([step('a'), step('b')]), [orchestrator()])
    expect(out.nodes).toHaveLength(2)
    expect(out.nodes.map((n) => n.id)).toEqual([planNodeId('a'), planNodeId('b')])
    expect(out.nodes.every((n) => n.type === 'planstep')).toBe(true)
  })

  it('lays the steps out left to right in running order', () => {
    const out = planFlow(plan([step('a'), step('b'), step('c')]), [orchestrator()])
    const xs = out.nodes.map((n) => n.position.x)
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
    // One row: the order is the x axis, and nothing else moves.
    expect(new Set(out.nodes.map((n) => n.position.y)).size).toBe(1)
  })

  it('leaves the steps clear of the orchestrator and of its children', () => {
    const anchor = orchestrator('orc', 100, 500)
    const out = planFlow(plan([step('a')]), [anchor])
    // Right of the orchestrator's edge…
    expect(out.nodes[0].position.x).toBeGreaterThan(anchor.position.x + 260)
    // …and above it, which is the band children never occupy.
    expect(out.nodes[0].position.y + PLAN_STEP_SIZE.h).toBeLessThan(anchor.position.y)
  })

  it('does not space steps by their order alone', () => {
    // Guards the gap: two steps must not overlap each other.
    const out = planFlow(plan([step('a'), step('b')]), [orchestrator()])
    const gap = out.nodes[1].position.x - out.nodes[0].position.x
    expect(gap).toBeGreaterThanOrEqual(PLAN_STEP_SIZE.w)
  })

  it('chains the orchestrator into the first step and each step into the next', () => {
    const out = planFlow(plan([step('a'), step('b')]), [orchestrator()])
    const lead = out.edges.find((e) => e.source === 'orc')
    expect(lead?.target).toBe(planNodeId('a'))
    expect(lead?.sourceHandle).toBe('spawns')

    const seq = out.edges.find((e) => e.source === planNodeId('a'))
    expect(seq?.target).toBe(planNodeId('b'))
  })

  it('wires a step that ran to the agent it became', () => {
    const steps = [step('a', { state: 'done', childId: 'kid' })]
    const out = planFlow(plan(steps), [orchestrator(), child('kid')])
    const ran = out.edges.find((e) => e.target === 'kid')
    expect(ran?.source).toBe(planNodeId('a'))
    expect(ran?.targetHandle).toBe('spawned-by')
  })

  it('does not wire to a child that has been deleted from the canvas', () => {
    const steps = [step('a', { state: 'done', childId: 'gone' })]
    const out = planFlow(plan(steps), [orchestrator()])
    expect(out.edges.some((e) => e.target === 'gone')).toBe(false)
  })

  it('is empty when there is no plan, no steps, or no orchestrator left', () => {
    expect(planFlow(null, [orchestrator()]).nodes).toEqual([])
    expect(planFlow(undefined, [orchestrator()]).nodes).toEqual([])
    expect(planFlow(plan([]), [orchestrator()]).nodes).toEqual([])
    // The agent that wrote the plan was deleted: steps anchored to nothing.
    expect(planFlow(plan([step('a')]), []).nodes).toEqual([])
    expect(planFlow(plan([step('a')]), []).edges).toEqual([])
  })

  it('makes nodes the canvas cannot drag, select, or delete', () => {
    // They are computed from the plan every render, so any of those would be
    // undone on the next one — an interaction that appears to work and does not.
    const out = planFlow(plan([step('a')]), [orchestrator()])
    expect(out.nodes[0].draggable).toBe(false)
    expect(out.nodes[0].selectable).toBe(false)
    expect(out.nodes[0].deletable).toBe(false)
  })

  it('gives step nodes ids that cannot collide with a stored node', () => {
    const out = planFlow(plan([step('orc')]), [orchestrator()])
    expect(out.nodes[0].id).not.toBe('orc')
  })

  it('carries the running order and persona onto the node', () => {
    const out = planFlow(plan([step('a'), step('b', { persona: 'implementer' })]), [orchestrator()])
    expect(out.nodes[1].data).toMatchObject({ stepId: 'b', index: 1, persona: 'implementer' })
  })
})
