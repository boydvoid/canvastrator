/**
 * The plan, drawn on the canvas as the flow it describes.
 *
 * A plan is a sequence of spawns that have not happened yet, and the canvas is
 * where spawns are visible — so a plan that lives only in a dropdown is the
 * one part of the machine you cannot see or reach from the surface it runs on.
 * These nodes put the steps in front of the orchestrator that wrote them, in
 * the order they will run, each with the trigger to run it.
 *
 * They are *derived*, never stored. The plan is the single source of truth and
 * these are a view of it: nothing to keep in step, nothing to persist, and no
 * way for the canvas to disagree with the panel about what the plan says. It
 * is the same reason a session's working directory is read off its folder edge
 * rather than kept as a second copy on the node.
 */
import type { Edge, Node } from '@xyflow/react'
import type { GtNode } from './store'
import type { Plan, PlanStep } from './types'

export const PLAN_STEP_SIZE = { w: 210, h: 74 }

/** Between one step and the next. */
const GAP_X = 30
/**
 * Clear of the orchestrator's right edge, matching the gap a spawned child
 * lands at — the steps are prospective children and should line up with the
 * real ones rather than sitting at some other distance.
 */
const LEAD_X = 150
/**
 * Above the orchestrator. Children fan *downward* from it, so the plan takes
 * the empty band above and the two never fight for the same space.
 */
const RISE_Y = 80

/** What a step node carries. The step itself is read live from the store. */
export type PlanStepNodeData = {
  stepId: string
  /** Its place in the running order, for the number in the corner. */
  index: number
  /** Denormalised so the node has something to draw before it subscribes. */
  persona: string
  state: PlanStep['state']
}

export type PlanFlow = { nodes: Node[]; edges: Edge[] }

const EMPTY: PlanFlow = { nodes: [], edges: [] }

/**
 * The step nodes and the wires between them.
 *
 * Returns nothing when there is no plan, or when the agent that wrote it has
 * been deleted — steps anchored to a missing orchestrator would float on the
 * canvas with nothing to explain where they came from.
 */
export function planFlow(plan: Plan | null | undefined, nodes: GtNode[]): PlanFlow {
  if (!plan?.steps.length) return EMPTY

  const anchor = nodes.find((n) => n.id === plan.fromNodeId)
  if (!anchor) return EMPTY

  const anchorW = (anchor.width as number | undefined) ?? 260
  const left = anchor.position.x + anchorW + LEAD_X
  const top = anchor.position.y - PLAN_STEP_SIZE.h - RISE_Y

  const stepNodes: Node[] = plan.steps.map((step, i) => ({
    id: planNodeId(step.id),
    type: 'planstep',
    position: { x: left + i * (PLAN_STEP_SIZE.w + GAP_X), y: top },
    width: PLAN_STEP_SIZE.w,
    height: PLAN_STEP_SIZE.h,
    // Positions are computed, so dragging one would spring back on the next
    // render — better to not offer the handle than to offer one that lies.
    draggable: false,
    // Selection lives on the node object, and these are rebuilt from the plan
    // every render, so a selection could never survive to be acted on.
    selectable: false,
    deletable: false,
    data: {
      stepId: step.id,
      index: i,
      persona: step.persona,
      state: step.state,
    } satisfies PlanStepNodeData,
  }))

  const edges: Edge[] = []

  // The orchestrator into the first step. `spawns` because that is what a step
  // is: the handle a real child hangs off, holding the one not yet made.
  edges.push({
    id: `planlead_${plan.fromNodeId}_${plan.steps[0].id}`,
    source: plan.fromNodeId,
    sourceHandle: 'spawns',
    target: planNodeId(plan.steps[0].id),
    targetHandle: 'step-in',
    type: 'plan',
    selectable: false,
    deletable: false,
  })

  // Step to step, which is the running order made visible.
  for (let i = 1; i < plan.steps.length; i++) {
    edges.push({
      id: `planseq_${plan.steps[i - 1].id}_${plan.steps[i].id}`,
      source: planNodeId(plan.steps[i - 1].id),
      sourceHandle: 'step-out',
      target: planNodeId(plan.steps[i].id),
      targetHandle: 'step-in',
      type: 'plan',
      selectable: false,
      deletable: false,
    })
  }

  // A step that has run, down to the agent it became. This is the whole reason
  // a step keeps its childId: without it a finished plan says work happened
  // but not where it went, and the agent below says it exists but not which
  // step asked for it.
  for (const step of plan.steps) {
    if (!step.childId) continue
    if (!nodes.some((n) => n.id === step.childId)) continue
    edges.push({
      id: `planran_${step.id}_${step.childId}`,
      source: planNodeId(step.id),
      sourceHandle: 'step-out',
      target: step.childId,
      targetHandle: 'spawned-by',
      type: 'plan',
      selectable: false,
      deletable: false,
    })
  }

  return { nodes: stepNodes, edges }
}

/**
 * The canvas id for a step.
 *
 * Prefixed so it can never collide with a stored node's id, which matters
 * because these are merged into the same array React Flow is given.
 */
export const planNodeId = (stepId: string) => `plannode_${stepId}`
