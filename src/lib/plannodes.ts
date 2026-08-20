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

/**
 * The shape card. Wider than a step because it carries a sentence of reasoning
 * rather than a task line, and that sentence is the whole point of it.
 *
 * Declared rather than measured, like the step nodes and for the same reason:
 * these are rebuilt from the plan on every render, so anything React Flow
 * measures is thrown away on the next one — and a node it considers unmeasured
 * is a node it draws with `visibility: hidden`.
 */
export const SHAPE_SIZE = { w: 300, h: 164 }

/** Extra room for the mismatch warning, which is a paragraph when it appears. */
const WARNING_H = 52

/** Between the shape card and the first step it produced. */
const SHAPE_GAP_X = 40

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

/** What a shape node carries. The plan itself is read live from the store. */
export type ShapeNodeData = {
  fromNodeId: string
}

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

  // The shape card sits directly above the orchestrator that chose it, and the
  // steps run to its right. Read left to right, the band above the agent is
  // the decision and then its consequences, which is the order they happened
  // in — see `ShapeNode` for why the shape gets a card of its own at all.
  const shapeLeft = anchor.position.x
  const left = shapeLeft + SHAPE_SIZE.w + SHAPE_GAP_X + LEAD_X
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

  // The shape, when the orchestrator declared one. A plan without one still
  // runs — in order, the safe reading — so its absence is not an error and
  // draws no card rather than a card that says "unknown".
  const hasShape = !!plan.pattern
  const shapeH = SHAPE_SIZE.h + (plan.warning ? WARNING_H : 0)
  if (hasShape) {
    stepNodes.unshift({
      id: shapeNodeId(plan.fromNodeId),
      type: 'shape',
      position: {
        x: shapeLeft,
        // Bottom-aligned with the steps: the two are one row, and a card that
        // is taller than a step must not push the row upward.
        y: top + PLAN_STEP_SIZE.h - shapeH,
      },
      width: SHAPE_SIZE.w,
      height: shapeH,
      draggable: false,
      selectable: false,
      deletable: false,
      data: { fromNodeId: plan.fromNodeId } satisfies ShapeNodeData,
    })
  }

  // Into the first step, from the shape card where there is one. `spawns`
  // because that is what a step is: the handle a real child hangs off, holding
  // the one not yet made.
  edges.push({
    id: `planlead_${plan.fromNodeId}_${plan.steps[0].id}`,
    source: hasShape ? shapeNodeId(plan.fromNodeId) : plan.fromNodeId,
    sourceHandle: hasShape ? 'shape-out' : 'spawns',
    target: planNodeId(plan.steps[0].id),
    targetHandle: 'step-in',
    type: 'plan',
    selectable: false,
    deletable: false,
  })

  // The orchestrator up into the card, so the decision is visibly its.
  if (hasShape) {
    edges.push({
      id: `planshape_${plan.fromNodeId}`,
      source: plan.fromNodeId,
      sourceHandle: 'spawns',
      target: shapeNodeId(plan.fromNodeId),
      targetHandle: 'shape-in',
      type: 'plan',
      selectable: false,
      deletable: false,
    })
  }

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

/** The canvas id for the shape card, one per plan, keyed by its author. */
export const shapeNodeId = (fromNodeId: string) => `shapenode_${fromNodeId}`
