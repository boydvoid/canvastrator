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
import { Position } from '@xyflow/react'
import type { Edge, Node, NodeHandle } from '@xyflow/react'
import { addSlots } from './plan'
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

/**
 * The button that puts a step of your own into the running order.
 *
 * Small on purpose. It is an insertion point, not a step, and it sits in the
 * gap between two of them — big enough to hit, small enough that a row of
 * them does not read as another rank of nodes.
 */
export const PLAN_ADD_SIZE = { w: 22, h: 22 }

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

/**
 * Between one plan's row and the next one stacked above it.
 *
 * An orchestrator fixing two things at once has two plans, and they are two
 * jobs rather than one long one — so they get a band each, in the order they
 * were proposed, and the oldest keeps the place nearest the agent. Stacking
 * upward from the oldest is what makes a new plan appear without shoving the
 * one you were reading somewhere else.
 */
const PLAN_GAP_Y = 30

/**
 * Where a wire meets one of these nodes, declared rather than measured.
 *
 * React Flow reads handle positions off the DOM and caches them on the node
 * object it measured. These nodes are rebuilt from the plan on every render,
 * so that cache is discarded as fast as it is filled — and an edge with no
 * bounds at either end is not drawn at all. That is why a plan appeared as a
 * row of boxes with nothing between them: the steps were there, the wires
 * were in the graph, and every one of them was skipped for want of a handle.
 *
 * Declaring the geometry takes the DOM out of it. We already know where these
 * handles are — we chose the sizes a few lines up — so nothing here can go
 * stale, and no amount of rebuilding costs the plan its wires. Kept in step
 * with the `Handle`s in `PlanStepNode` and `ShapeNode` by hand: same ids, same
 * sides. A one-pixel box is enough, since React Flow only reads its centre.
 */
const handle = (
  id: string,
  type: NodeHandle['type'],
  position: Position,
  x: number,
  y: number,
): NodeHandle => ({ id, type, position, x, y, width: 1, height: 1 })

/** The left and right ends of a node that sits in the running order. */
const inOut = (id: [string, string], w: number, h: number): NodeHandle[] => [
  handle(id[0], 'target', Position.Left, 0, h / 2),
  handle(id[1], 'source', Position.Right, w - 1, h / 2),
]

/** What a shape node carries. The plan itself is read live from the store. */
export type ShapeNodeData = {
  planId: string
}

/** What an insertion point carries: which plan, and where in its order. */
export type PlanAddNodeData = {
  planId: string
  index: number
}

/** What a step node carries. The step itself is read live from the store. */
export type PlanStepNodeData = {
  /** Which plan it belongs to — a canvas holds several at once. */
  planId: string
  stepId: string
  /** Its place in the running order, for the number in the corner. */
  index: number
  /** How many steps there are, so a step can say 2/3 rather than 2. */
  count: number
  /** Denormalised so the node has something to draw before it subscribes. */
  persona: string
  state: PlanStep['state']
}

export type PlanFlow = { nodes: Node[]; edges: Edge[] }

const EMPTY: PlanFlow = { nodes: [], edges: [] }

/** How tall one plan's band is: its steps, or its card where that is taller. */
const bandHeight = (plan: Plan) =>
  Math.max(PLAN_STEP_SIZE.h, plan.pattern ? shapeHeight(plan) : 0)

/** The card grows by a paragraph when the plan and its shape disagree. */
const shapeHeight = (plan: Plan) => SHAPE_SIZE.h + (plan.warning ? WARNING_H : 0)

/**
 * Every plan on the canvas, drawn as the flow it describes.
 *
 * Plans are grouped by the agent that wrote them and stacked in the band above
 * it, oldest nearest. A plan whose orchestrator has been deleted draws nothing:
 * steps anchored to a missing agent would float with nothing to explain where
 * they came from.
 */
export function planFlow(plans: Plan[], nodes: GtNode[]): PlanFlow {
  if (!plans.length) return EMPTY

  const out: PlanFlow = { nodes: [], edges: [] }
  const byAnchor = new Map<string, Plan[]>()
  for (const plan of plans) {
    if (!plan.steps.length) continue
    const group = byAnchor.get(plan.fromNodeId)
    if (group) group.push(plan)
    else byAnchor.set(plan.fromNodeId, [plan])
  }

  for (const [anchorId, group] of byAnchor) {
    const anchor = nodes.find((n) => n.id === anchorId)
    if (!anchor) continue
    let rise = RISE_Y
    for (const plan of group) {
      const band = planBand(plan, anchor, rise, nodes)
      out.nodes.push(...band.nodes)
      out.edges.push(...band.edges)
      rise += bandHeight(plan) + PLAN_GAP_Y
    }
  }

  return out
}

/** One plan, laid out `rise` above the agent that wrote it. */
function planBand(plan: Plan, anchor: GtNode, rise: number, nodes: GtNode[]): PlanFlow {
  // The shape card sits directly above the orchestrator that chose it, and the
  // steps run to its right. Read left to right, the band above the agent is
  // the decision and then its consequences, which is the order they happened
  // in — see `ShapeNode` for why the shape gets a card of its own at all.
  const shapeLeft = anchor.position.x
  const left = shapeLeft + SHAPE_SIZE.w + SHAPE_GAP_X + LEAD_X
  const top = anchor.position.y - PLAN_STEP_SIZE.h - rise

  const stepNodes: Node[] = plan.steps.map((step, i) => ({
    id: planNodeId(step.id),
    type: 'planstep',
    position: { x: left + i * (PLAN_STEP_SIZE.w + GAP_X), y: top },
    width: PLAN_STEP_SIZE.w,
    height: PLAN_STEP_SIZE.h,
    handles: inOut(['step-in', 'step-out'], PLAN_STEP_SIZE.w, PLAN_STEP_SIZE.h),
    // Positions are computed, so dragging one would spring back on the next
    // render — better to not offer the handle than to offer one that lies.
    draggable: false,
    // Selection lives on the node object, and these are rebuilt from the plan
    // every render, so a selection could never survive to be acted on.
    selectable: false,
    deletable: false,
    data: {
      planId: plan.id,
      stepId: step.id,
      index: i,
      count: plan.steps.length,
      persona: step.persona,
      state: step.state,
    } satisfies PlanStepNodeData,
  }))

  const edges: Edge[] = []

  // The shape, when the orchestrator declared one. A plan without one still
  // runs — in order, the safe reading — so its absence is not an error and
  // draws no card rather than a card that says "unknown".
  const hasShape = !!plan.pattern
  const shapeH = shapeHeight(plan)
  if (hasShape) {
    stepNodes.unshift({
      id: shapeNodeId(plan.id),
      type: 'shape',
      position: {
        x: shapeLeft,
        // Bottom-aligned with the steps: the two are one row, and a card that
        // is taller than a step must not push the row upward.
        y: top + PLAN_STEP_SIZE.h - shapeH,
      },
      width: SHAPE_SIZE.w,
      height: shapeH,
      // The card takes its wire in from below, where the orchestrator is.
      handles: [
        handle('shape-in', 'target', Position.Bottom, SHAPE_SIZE.w / 2 - 1, shapeH - 1),
        handle('shape-out', 'source', Position.Right, SHAPE_SIZE.w - 1, shapeH / 2),
      ],
      draggable: false,
      selectable: false,
      deletable: false,
      data: { planId: plan.id } satisfies ShapeNodeData,
    })
  }

  // Into the first step, from the shape card where there is one. `spawns`
  // because that is what a step is: the handle a real child hangs off, holding
  // the one not yet made.
  // The pattern rides on every wire of the plan, so the card and the steps it
  // produced read as one object rather than as a card that happens to sit next
  // to some boxes. See `PlanEdge`.
  const rail = plan.pattern ? { pattern: plan.pattern.id } : undefined

  edges.push({
    id: `planlead_${plan.fromNodeId}_${plan.steps[0].id}`,
    source: hasShape ? shapeNodeId(plan.id) : plan.fromNodeId,
    sourceHandle: hasShape ? 'shape-out' : 'spawns',
    target: planNodeId(plan.steps[0].id),
    targetHandle: 'step-in',
    type: 'plan',
    data: rail,
    selectable: false,
    deletable: false,
  })

  // The orchestrator up into the card, so the decision is visibly its.
  if (hasShape) {
    edges.push({
      id: `planshape_${plan.id}`,
      source: plan.fromNodeId,
      sourceHandle: 'spawns',
      target: shapeNodeId(plan.id),
      targetHandle: 'shape-in',
      type: 'plan',
      data: rail,
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
      data: rail,
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

  // Somewhere to put a step of your own, in every gap the running order still
  // has a future in. They are nodes rather than something drawn on the step
  // cards because the last one belongs after the final step, where there is no
  // card to hang it off — and an insertion point that exists in three of four
  // gaps teaches the wrong rule.
  const addNodes: Node[] = addSlots(plan.steps).map((i) => ({
    id: addNodeId(plan.id, i),
    type: 'planadd',
    position: {
      // Half a gap before the step it would push along, which for the slot at
      // the end is half a gap past the last step's right edge.
      x: left + i * (PLAN_STEP_SIZE.w + GAP_X) - GAP_X / 2 - PLAN_ADD_SIZE.w / 2,
      y: top + (PLAN_STEP_SIZE.h - PLAN_ADD_SIZE.h) / 2,
    },
    width: PLAN_ADD_SIZE.w,
    height: PLAN_ADD_SIZE.h,
    draggable: false,
    selectable: false,
    deletable: false,
    data: { planId: plan.id, index: i } satisfies PlanAddNodeData,
  }))

  return { nodes: [...stepNodes, ...addNodes], edges }
}

/**
 * The canvas id for a step.
 *
 * Prefixed so it can never collide with a stored node's id, which matters
 * because these are merged into the same array React Flow is given.
 */
export const planNodeId = (stepId: string) => `plannode_${stepId}`

/**
 * The canvas id for an insertion point, keyed by the slot rather than by a
 * step: the slot at the end has no step to name it after.
 */
export const addNodeId = (planId: string, index: number) => `planadd_${planId}_${index}`

/** The canvas id for the shape card, one per plan. */
export const shapeNodeId = (planId: string) => `shapenode_${planId}`
