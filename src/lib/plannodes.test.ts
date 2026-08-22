import { describe, expect, it } from 'vitest'
import { addNodeId, planFlow, planNodeId, PLAN_STEP_SIZE, type PlanFlow } from './plannodes'
import type { Node } from '@xyflow/react'
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

let planSeq = 0
const plan = (steps: PlanStep[], fromNodeId = 'orc'): Plan => ({
  id: `plan_${planSeq++}`,
  fromNodeId,
  goal: 'do the thing',
  steps,
  proposedAt: 0,
})

/** The steps alone, without the insertion points that sit between them. */
const stepsOf = (out: { nodes: Node[] }) => out.nodes.filter((n) => n.type === 'planstep')

describe('planFlow', () => {
  it('makes one node per step', () => {
    const out = planFlow([plan([step('a'), step('b')])], [orchestrator()])
    expect(stepsOf(out)).toHaveLength(2)
    expect(stepsOf(out).map((n) => n.id)).toEqual([planNodeId('a'), planNodeId('b')])
  })

  it('lays the steps out left to right in running order', () => {
    const out = planFlow([plan([step('a'), step('b'), step('c')])], [orchestrator()])
    const xs = stepsOf(out).map((n) => n.position.x)
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
    // One row: the order is the x axis, and nothing else moves.
    expect(new Set(stepsOf(out).map((n) => n.position.y)).size).toBe(1)
  })

  it('leaves the steps clear of the orchestrator and of its children', () => {
    const anchor = orchestrator('orc', 100, 500)
    const out = planFlow([plan([step('a')])], [anchor])
    // Right of the orchestrator's edge…
    expect(stepsOf(out)[0].position.x).toBeGreaterThan(anchor.position.x + 260)
    // …and above it, which is the band children never occupy.
    expect(stepsOf(out)[0].position.y + PLAN_STEP_SIZE.h).toBeLessThan(anchor.position.y)
  })

  it('does not space steps by their order alone', () => {
    // Guards the gap: two steps must not overlap each other.
    const out = planFlow([plan([step('a'), step('b')])], [orchestrator()])
    const gap = stepsOf(out)[1].position.x - stepsOf(out)[0].position.x
    expect(gap).toBeGreaterThanOrEqual(PLAN_STEP_SIZE.w)
  })

  it('chains the orchestrator into the first step and each step into the next', () => {
    const out = planFlow([plan([step('a'), step('b')])], [orchestrator()])
    const lead = out.edges.find((e) => e.source === 'orc')
    expect(lead?.target).toBe(planNodeId('a'))
    expect(lead?.sourceHandle).toBe('spawns')

    const seq = out.edges.find((e) => e.source === planNodeId('a'))
    expect(seq?.target).toBe(planNodeId('b'))
  })

  it('wires a step that ran to the agent it became', () => {
    const steps = [step('a', { state: 'done', childId: 'kid' })]
    const out = planFlow([plan(steps)], [orchestrator(), child('kid')])
    const ran = out.edges.find((e) => e.target === 'kid')
    expect(ran?.source).toBe(planNodeId('a'))
    expect(ran?.targetHandle).toBe('spawned-by')
  })

  it('does not wire to a child that has been deleted from the canvas', () => {
    const steps = [step('a', { state: 'done', childId: 'gone' })]
    const out = planFlow([plan(steps)], [orchestrator()])
    expect(out.edges.some((e) => e.target === 'gone')).toBe(false)
  })

  it('is empty when there is no plan, no steps, or no orchestrator left', () => {
    expect(planFlow([], [orchestrator()]).nodes).toEqual([])
    expect(planFlow([], [orchestrator()]).nodes).toEqual([])
    expect(planFlow([plan([])], [orchestrator()]).nodes).toEqual([])
    // The agent that wrote the plan was deleted: steps anchored to nothing.
    expect(planFlow([plan([step('a')])], []).nodes).toEqual([])
    expect(planFlow([plan([step('a')])], []).edges).toEqual([])
  })

  it('makes nodes the canvas cannot drag, select, or delete', () => {
    // They are computed from the plan every render, so any of those would be
    // undone on the next one — an interaction that appears to work and does not.
    const out = planFlow([plan([step('a')])], [orchestrator()])
    expect(out.nodes.every((n) => n.draggable === false)).toBe(true)
    expect(out.nodes.every((n) => n.selectable === false)).toBe(true)
    expect(out.nodes.every((n) => n.deletable === false)).toBe(true)
  })

  it('gives step nodes ids that cannot collide with a stored node', () => {
    const out = planFlow([plan([step('orc')])], [orchestrator()])
    expect(out.nodes.some((n) => n.id === 'orc')).toBe(false)
  })

  it('carries the running order and persona onto the node', () => {
    const out = planFlow([plan([step('a'), step('b', { persona: 'implementer' })])], [orchestrator()])
    expect(stepsOf(out)[1].data).toMatchObject({ stepId: 'b', index: 1, persona: 'implementer' })
  })

  /**
   * The gaps are how a step of your own gets into the order — see `addSlots`
   * for which of them are offered.
   */
  it('puts an insertion point in every gap the order still has a future in', () => {
    const p = plan([step('a'), step('b')])
    const out = planFlow([p], [orchestrator()])
    const adds = out.nodes.filter((n) => n.type === 'planadd')
    expect(adds.map((n) => n.id)).toEqual([
      addNodeId(p.id, 0),
      addNodeId(p.id, 1),
      addNodeId(p.id, 2),
    ])
    expect(adds.map((n) => n.data)).toEqual([
      { planId: p.id, index: 0 },
      { planId: p.id, index: 1 },
      { planId: p.id, index: 2 },
    ])
  })

  it('sits each insertion point between the steps it would come between', () => {
    const p = plan([step('a'), step('b')])
    const out = planFlow([p], [orchestrator()])
    const [first, second] = stepsOf(out)
    const middle = out.nodes.find((n) => n.id === addNodeId(p.id, 1))!
    expect(middle.position.x).toBeGreaterThan(first.position.x + PLAN_STEP_SIZE.w)
    expect(middle.position.x).toBeLessThan(second.position.x)
    // On the same line as the row it interrupts.
    expect(middle.position.y).toBeGreaterThan(first.position.y)
    expect(middle.position.y + (middle.height ?? 0)).toBeLessThan(first.position.y + PLAN_STEP_SIZE.h)
  })

  it('offers no insertion point on a plan that has finished running', () => {
    const out = planFlow([plan([step('a', { state: 'done' })])], [orchestrator()])
    expect(out.nodes.some((n) => n.type === 'planadd')).toBe(false)
  })
})

describe('planFlow with several plans', () => {
  const band = (out: PlanFlow, planId: string) =>
    out.nodes.filter((n) => (n.data as { planId?: string }).planId === planId)

  it('stacks a second plan above the first, without moving it', () => {
    const first = plan([step('a')])
    const second = plan([step('b')])
    const alone = planFlow([first], [orchestrator('orc', 0, 800)])
    const both = planFlow([first, second], [orchestrator('orc', 0, 800)])

    const firstAlone = alone.nodes.find((n) => n.id === planNodeId('a'))!
    const firstNow = both.nodes.find((n) => n.id === planNodeId('a'))!
    // The plan you were reading stays where it was when another one arrives.
    expect(firstNow.position).toEqual(firstAlone.position)

    const secondRow = both.nodes.find((n) => n.id === planNodeId('b'))!
    expect(secondRow.position.y).toBeLessThan(firstNow.position.y)
    expect(secondRow.position.x).toBe(firstNow.position.x)
  })

  it('gives each plan its own nodes and wires, with no ids in common', () => {
    const first = plan([step('a')], 'orc')
    const second = plan([step('b')], 'orc')
    const out = planFlow([first, second], [orchestrator()])
    expect(band(out, first.id).length).toBeGreaterThan(0)
    expect(band(out, second.id).length).toBe(band(out, first.id).length)
    expect(new Set(out.nodes.map((n) => n.id)).size).toBe(out.nodes.length)
    expect(new Set(out.edges.map((e) => e.id)).size).toBe(out.edges.length)
  })

  it('draws each orchestrator its own plans and skips one that has been deleted', () => {
    const mine = plan([step('a')], 'orc')
    const theirs = plan([step('b')], 'other')
    const orphan = plan([step('c')], 'gone')
    const out = planFlow([mine, theirs, orphan], [orchestrator('orc'), orchestrator('other', 900)])
    expect(out.nodes.some((n) => n.id === planNodeId('a'))).toBe(true)
    expect(out.nodes.some((n) => n.id === planNodeId('b'))).toBe(true)
    expect(out.nodes.some((n) => n.id === planNodeId('c'))).toBe(false)
  })
})
