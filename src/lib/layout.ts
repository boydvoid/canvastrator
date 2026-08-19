import type { Edge } from '@xyflow/react'
import type { GtNode } from './store'

/**
 * Laying out a Canvastrator canvas is not a generic graph problem — the graph has a
 * grammar. Inputs feed a session from the left, files fall out of it on the
 * right, and children hang below their parent. A generic layered layout throws
 * that away and produces something technically untangled but meaningless, so
 * this places nodes by their role instead.
 */

export type Box = { x: number; y: number; w: number; h: number }
export type Placement = Record<string, { x: number; y: number }>

const GAP_X = 90
const GAP_Y = 40
/** Between one session's block and the next. */
const BLOCK_GAP_Y = 90
const CHILD_INDENT = 60

/** Fallback sizes for nodes React Flow hasn't measured yet. */
const DEFAULT_SIZE: Record<GtNode['type'], { w: number; h: number }> = {
  session: { w: 400, h: 340 },
  file: { w: 224, h: 64 },
  folder: { w: 256, h: 76 },
  skill: { w: 240, h: 190 },
  personality: { w: 256, h: 280 },
  summary: { w: 260, h: 96 },
  mcp: { w: 240, h: 150 },
  mcptool: { w: 208, h: 52 },
}

export const sizeOf = (n: GtNode) => ({
  w: (n.width as number | undefined) ?? DEFAULT_SIZE[n.type]?.w ?? 240,
  h: (n.height as number | undefined) ?? DEFAULT_SIZE[n.type]?.h ?? 120,
})

export const boxOf = (n: GtNode): Box => ({ x: n.position.x, y: n.position.y, ...sizeOf(n) })

const overlaps = (a: Box, b: Box, pad = 16) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y

/**
 * Nudge a box downward until it sits clear of everything else. Used when a node
 * appears on its own — an agent touching a file shouldn't drop a node on top of
 * one that's already there, which is exactly what it used to do.
 */
export function findFreeSpot(desired: Box, taken: Box[], step = 24): { x: number; y: number } {
  const spot = { ...desired }
  // Bounded so a dense canvas can't spin: 400 steps is ~9600px of travel.
  for (let i = 0; i < 400; i++) {
    if (!taken.some((t) => overlaps(spot, t))) break
    spot.y += step
  }
  return { x: spot.x, y: spot.y }
}

type Groups = {
  /** session id → the files it touched */
  files: Map<string, GtNode[]>
  /** session id → folders / skills / personalities wired into it */
  inputs: Map<string, GtNode[]>
  /** session id → the turn summaries it produced */
  summaries: Map<string, GtNode[]>
  /** session id → child session ids, by spawn edge */
  children: Map<string, string[]>
  roots: GtNode[]
  orphans: GtNode[]
}

function group(nodes: GtNode[], edges: Edge[]): Groups {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const sessions = nodes.filter((n) => n.type === 'session')

  const files = new Map<string, GtNode[]>()
  const inputs = new Map<string, GtNode[]>()
  const summaries = new Map<string, GtNode[]>()
  const children = new Map<string, string[]>()
  const claimed = new Set<string>()

  for (const e of edges) {
    const source = byId.get(e.source)
    const target = byId.get(e.target)
    if (!source || !target) continue

    // session → file: something the agent read or wrote. Summaries are handled
    // separately below — they belong in the left column with the turn history.
    if (e.type === 'file' && source.type === 'session' && target.type === 'file') {
      files.set(source.id, [...(files.get(source.id) ?? []), target])
      claimed.add(target.id)
    }
    // file/folder/skill/personality → session: an input
    if (
      target.type === 'session' &&
      (e.type === 'cwd' || e.type === 'attach' || (e.type === 'file' && source.type === 'file'))
    ) {
      inputs.set(target.id, [...(inputs.get(target.id) ?? []), source])
      claimed.add(source.id)
    }
    // session → summary: an account of one of its turns
    if (e.type === 'summary' && source.type === 'session' && target.type === 'summary') {
      summaries.set(source.id, [...(summaries.get(source.id) ?? []), target])
      claimed.add(target.id)
    }
    if (e.type === 'spawn' && source.type === 'session' && target.type === 'session') {
      children.set(source.id, [...(children.get(source.id) ?? []), target.id])
      claimed.add(target.id)
    }
  }

  return {
    files,
    inputs,
    summaries,
    children,
    roots: sessions.filter((s) => !claimed.has(s.id)),
    // Nodes attached to nothing still need somewhere to go.
    orphans: nodes.filter((n) => n.type !== 'session' && !claimed.has(n.id)),
  }
}

/**
 * Arrange the whole canvas. Returns positions rather than nodes so the caller
 * decides how to apply them.
 */
export function layoutCanvas(
  nodes: GtNode[],
  edges: Edge[],
  /**
   * Nodes the layout is allowed to move — the ones an agent placed. Anything
   * else was put where it is on purpose, and gets treated as a fixed landmark
   * the rest arranges around. Omit to move everything, which is what an
   * explicit "tidy all" wants.
   */
  movable?: ReadonlySet<string>,
): Placement {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const { files, inputs, summaries, children, roots, orphans } = group(nodes, edges)
  const out: Placement = {}

  // Widest input column across the canvas, so every session starts at the same
  // x and the whole thing reads as columns rather than a ragged staircase.
  const inputColWidth = Math.max(
    0,
    ...[...inputs.values(), ...summaries.values()].flat().map((n) => sizeOf(n).w),
  )
  const sessionX = inputColWidth ? inputColWidth + GAP_X : 0

  let cursorY = 0

  const owns = (id: string) => !movable || movable.has(id)

  const placeSession = (id: string, depth: number, topY: number): number => {
    const session = byId.get(id)
    if (!session) return topY
    const size = sizeOf(session)
    // A session the user placed anchors its own block: its files and inputs
    // arrange around where it actually is, not where the layout would put it.
    const fixed = !owns(id)
    const x = fixed ? session.position.x : sessionX + depth * CHILD_INDENT
    const y = fixed ? session.position.y : topY
    if (!fixed) out[id] = { x, y }

    // Inputs stack to the left, vertically centred against the session.
    const mine = inputs.get(id) ?? []
    const inputsHeight =
      mine.reduce((sum, n) => sum + sizeOf(n).h, 0) + Math.max(0, mine.length - 1) * GAP_Y
    let iy = y + Math.max(0, (size.h - inputsHeight) / 2)
    for (const n of mine) {
      const s = sizeOf(n)
      if (owns(n.id)) out[n.id] = { x: x - GAP_X - s.w, y: iy }
      iy += s.h + GAP_Y
    }

    // Files stack to the right, in the order the agent touched them.
    // Outputs share one column on the right: files the turn touched, then the
    // summaries of those turns, oldest first.
    const tsOf = (n: GtNode) => (n.type === 'summary' ? n.data.ts : 0)
    const mineFiles = [
      ...(files.get(id) ?? []),
      ...[...(summaries.get(id) ?? [])].sort((a, b) => tsOf(a) - tsOf(b)),
    ]
    let fy = y
    for (const n of mineFiles) {
      const s = sizeOf(n)
      if (owns(n.id)) out[n.id] = { x: x + size.w + GAP_X, y: fy }
      fy += s.h + 20
    }

    // The block is as tall as its tallest column.
    let bottom = Math.max(y + size.h, iy - GAP_Y, fy - 20)

    for (const childId of children.get(id) ?? []) {
      bottom = placeSession(childId, depth + 1, bottom + BLOCK_GAP_Y)
    }
    return bottom
  }

  for (const root of roots) {
    cursorY = placeSession(root.id, 0, cursorY) + BLOCK_GAP_Y
  }

  // Unattached nodes park in a row underneath, rather than being left where
  // they happened to land.
  let ox = 0
  for (const n of orphans) {
    const s = sizeOf(n)
    if (owns(n.id)) out[n.id] = { x: ox, y: cursorY }
    ox += s.w + GAP_Y
  }

  // Fixed nodes never moved, so a placed node can still land on one. Nudge the
  // movable ones clear — the user's arrangement wins every time.
  if (movable) {
    const fixedBoxes = nodes
      .filter((n) => !movable.has(n.id))
      .map((n) => boxOf(n))
    if (fixedBoxes.length) {
      const taken = [...fixedBoxes]
      for (const id of Object.keys(out)) {
        const node = byId.get(id)
        if (!node) continue
        const spot = findFreeSpot({ ...out[id], ...sizeOf(node) }, taken)
        out[id] = spot
        taken.push({ ...spot, ...sizeOf(node) })
      }
    }
  }

  return out
}
