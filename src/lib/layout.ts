import dagre from '@dagrejs/dagre'
import type { Edge } from '@xyflow/react'
import type { GtNode } from './store'

/**
 * Laying out a Canvastrator canvas is not a generic graph problem — the graph
 * has a grammar, and it is the grammar of a flow chart read top to bottom:
 *
 *                        ┌───────────────┐
 *          folder ───────┤  orchestrator │
 *                        └───────┬───────┘
 *              ┌─────────────────┼─────────────────┐
 *          ┌───┴───┐         ┌───┴───┐         ┌───┴───┐
 *          │ agent │         │ agent │         │ agent │
 *          └───┬───┘         └───┬───┘         └───┬───┘
 *            file                file              file
 *            file                file
 *
 * The orchestrator sits at the top. Agents it spawned spread out in a row
 * beneath it, each centred in the space its own subtree occupies. Files an
 * agent touched hang directly below that agent, so a column reads as one
 * agent's work. Supporting nodes — the folder, skills, personas, MCP servers —
 * sit beside whatever they are attached to rather than getting a lane of their
 * own, and a server's tool nodes tuck under the server.
 *
 * Dagre does the hard half — ranking the agent tree, ordering each rank to
 * minimise crossings, and centring a parent over its children. Hand-rolling
 * that is how the old layout got into trouble: every new case (a support
 * overhanging to the left, a deep file column pushing into the next agent's
 * subtree) needed another correction to the width arithmetic, and they
 * disagreed with each other.
 *
 * So only the *tree* goes to dagre. Each agent's block — its supports, itself,
 * and its column of files — is measured and handed over as a single node, and
 * the contents are placed inside that node's box afterwards. Dagre never sees a
 * file, which is what keeps files in a column under their agent instead of
 * fanned across a rank as siblings.
 *
 * One wrinkle worth knowing: supports hang off the left only, so a block is not
 * symmetric about its session. Dagre centres a parent over the *box* it was
 * given, so the box reserves the support width on both sides. That wastes some
 * empty space to the right of a session and buys exact centring in return —
 * the alternative is correcting dagre's output afterwards, which is the trap
 * the previous implementation fell into.
 */

export type Box = { x: number; y: number; w: number; h: number }
export type Placement = Record<string, { x: number; y: number }>

/** Between a session and the supports stacked to its left. */
const SUPPORT_GAP_X = 90
/** Between two stacked supports. */
const SUPPORT_GAP_Y = 40
/** Between a session and the column of files below it, and between files. */
const OUTPUT_GAP_Y = 28
/** A parent's block to the row of children under it — deep enough to read as a level. */
const LEVEL_GAP_Y = 110
/** Between sibling subtrees in a row. */
const SIBLING_GAP_X = 80
/** A tool node's inset under the MCP server it belongs to. */
const SATELLITE_INDENT = 28

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

/** A support node, plus anything hanging off it (an MCP server's tools). */
type Support = { node: GtNode; kids: GtNode[] }

type Groups = {
  /** session id → files it touched and summaries it produced, in reading order */
  outputs: Map<string, GtNode[]>
  /** session id → folder / skills / personas / servers wired into it */
  supports: Map<string, Support[]>
  /** session id → child session ids, by spawn edge */
  children: Map<string, string[]>
  orphans: GtNode[]
}

function group(nodes: GtNode[], edges: Edge[]): Groups {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const sessions = nodes.filter((n) => n.type === 'session')

  const outFiles = new Map<string, GtNode[]>()
  const outSummaries = new Map<string, GtNode[]>()
  const supportOf = new Map<string, GtNode[]>()
  const children = new Map<string, string[]>()
  /** non-session node → the support node it hangs from (server → its tools) */
  const kidsOf = new Map<string, GtNode[]>()
  const claimed = new Set<string>()

  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v])

  for (const e of edges) {
    const source = byId.get(e.source)
    const target = byId.get(e.target)
    if (!source || !target) continue

    // session → file: something the agent read or wrote.
    if (e.type === 'file' && source.type === 'session' && target.type === 'file') {
      push(outFiles, source.id, target)
      claimed.add(target.id)
    }
    // session → summary: an account of one of its turns.
    if (e.type === 'summary' && source.type === 'session' && target.type === 'summary') {
      push(outSummaries, source.id, target)
      claimed.add(target.id)
    }
    // anything → session: a support, sitting beside it.
    if (
      target.type === 'session' &&
      (e.type === 'cwd' || e.type === 'attach' || (e.type === 'file' && source.type === 'file'))
    ) {
      push(supportOf, target.id, source)
      claimed.add(source.id)
    }
    // mcp server → the tool nodes that appeared when an agent called them.
    if (e.type === 'mcpuse' && target.type === 'mcptool') {
      push(kidsOf, source.id, target)
      claimed.add(target.id)
    }
    if (e.type === 'spawn' && source.type === 'session' && target.type === 'session') {
      push(children, source.id, target.id)
      claimed.add(target.id)
    }
  }

  // Summaries read oldest-first, and follow the files in the same column.
  const outputs = new Map<string, GtNode[]>()
  for (const s of sessions) {
    const merged = [
      ...(outFiles.get(s.id) ?? []),
      ...[...(outSummaries.get(s.id) ?? [])].sort(
        (a, b) => (a.type === 'summary' ? a.data.ts : 0) - (b.type === 'summary' ? b.data.ts : 0),
      ),
    ]
    if (merged.length) outputs.set(s.id, merged)
  }

  const supports = new Map<string, Support[]>()
  for (const [id, list] of supportOf) {
    supports.set(
      id,
      list.map((node) => ({ node, kids: kidsOf.get(node.id) ?? [] })),
    )
  }

  return {
    outputs,
    supports,
    children,
    // Nodes attached to nothing still need somewhere to go.
    orphans: nodes.filter((n) => n.type !== 'session' && !claimed.has(n.id)),
  }
}

/** How much room a support and its tool nodes need. */
function supportSize(s: Support) {
  const own = sizeOf(s.node)
  const w = Math.max(own.w, ...s.kids.map((k) => SATELLITE_INDENT + sizeOf(k).w))
  const h =
    own.h + s.kids.reduce((sum, k) => sum + OUTPUT_GAP_Y + sizeOf(k).h, 0)
  return { w, h }
}

/** Total height of a vertical stack, including the gaps between its members. */
const stackHeight = (heights: number[], gap: number) =>
  heights.reduce((sum, h) => sum + h, 0) + Math.max(0, heights.length - 1) * gap

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
  const { outputs, supports, children, orphans } = group(nodes, edges)
  const out: Placement = {}
  const owns = (id: string) => !movable || movable.has(id)

  /** Everything a session's block needs, measured before dagre sees it. */
  const blockOf = (id: string) => {
    const session = byId.get(id)
    const own = session ? sizeOf(session) : { w: 400, h: 340 }

    const mySupports = supports.get(id) ?? []
    const supportBoxes = mySupports.map(supportSize)
    const supportsW = Math.max(0, ...supportBoxes.map((b) => b.w))
    const supportsH = stackHeight(
      supportBoxes.map((b) => b.h),
      SUPPORT_GAP_Y,
    )

    const myOutputs = outputs.get(id) ?? []
    const outputsW = Math.max(0, ...myOutputs.map((n) => sizeOf(n).w))
    const outputsH = stackHeight(
      myOutputs.map((n) => sizeOf(n).h),
      OUTPUT_GAP_Y,
    )

    const coreW = Math.max(own.w, outputsW)
    const stackH = own.h + (myOutputs.length ? OUTPUT_GAP_Y + outputsH : 0)
    // Reserved on both sides so the session stays the centre of its own box.
    const reserve = supportsW ? supportsW + SUPPORT_GAP_X : 0

    return {
      own,
      coreW,
      stackH,
      supportsW,
      supportsH,
      width: coreW + 2 * reserve,
      height: Math.max(stackH, supportsH),
    }
  }

  const sessions = nodes.filter((n) => n.type === 'session')

  // ── the tree, by dagre ────────────────────────────────────────────────
  const g = new dagre.graphlib.Graph({ directed: true })
  g.setGraph({
    rankdir: 'TB',
    nodesep: SIBLING_GAP_X,
    ranksep: LEVEL_GAP_Y,
    // Independent flows on one canvas are separate components; keep them apart.
    marginx: 0,
    marginy: 0,
  })
  g.setDefaultEdgeLabel(() => ({}))

  const blocks = new Map<string, ReturnType<typeof blockOf>>()
  for (const s of sessions) {
    const block = blockOf(s.id)
    blocks.set(s.id, block)
    g.setNode(s.id, { width: block.width, height: block.height })
  }
  // Reversed on purpose. With no crossings to minimise, dagre's ordering
  // heuristic is free to pick any permutation of a sibling group, and it
  // consistently settles on the reverse of insertion order — so the first agent
  // an orchestrator spawned would end up rightmost. Feeding the edges backwards
  // puts spawn order back left to right. `orders siblings by spawn order`
  // in the tests pins this down, so a dagre upgrade that changes the heuristic
  // fails loudly instead of quietly mirroring everyone's canvas.
  const spawnEdges: Array<[string, string]> = []
  for (const [parent, kids] of children) {
    if (!g.hasNode(parent)) continue
    for (const kid of kids) if (g.hasNode(kid)) spawnEdges.push([parent, kid])
  }
  for (const [parent, kid] of spawnEdges.reverse()) g.setEdge(parent, kid)

  // Dagre breaks cycles itself, so a spawn loop can't hang the layout.
  dagre.layout(g)

  // ── the contents of each block ────────────────────────────────────────
  for (const s of sessions) {
    const block = blocks.get(s.id)!
    const laid = g.node(s.id) as { x: number; y: number } | undefined
    if (!laid) continue

    // A session the user placed anchors its own block: its supports and files
    // arrange around where it actually is, not where dagre would put it.
    const fixed = !owns(s.id)
    const cx = fixed ? s.position.x + block.own.w / 2 : laid.x
    const blockTop = fixed
      ? s.position.y - Math.round((block.height - block.stackH) / 2)
      : laid.y - block.height / 2

    const sx = Math.round(cx - block.own.w / 2)
    const sy = Math.round(blockTop + (block.height - block.stackH) / 2)
    if (!fixed) out[s.id] = { x: sx, y: sy }

    // Supports to the left, each with its own tool nodes tucked beneath it.
    const supportsRight = Math.round(cx - block.coreW / 2 - SUPPORT_GAP_X)
    let py = Math.round(blockTop + (block.height - block.supportsH) / 2)
    for (const sup of supports.get(s.id) ?? []) {
      const box = supportSize(sup)
      const nodeSize = sizeOf(sup.node)
      const left = supportsRight - nodeSize.w
      if (owns(sup.node.id)) out[sup.node.id] = { x: left, y: py }
      let ky = py + nodeSize.h + OUTPUT_GAP_Y
      for (const kid of sup.kids) {
        if (owns(kid.id)) out[kid.id] = { x: left + SATELLITE_INDENT, y: ky }
        ky += sizeOf(kid).h + OUTPUT_GAP_Y
      }
      py += box.h + SUPPORT_GAP_Y
    }

    // Outputs in a column directly below the session, centred on it.
    let oy = sy + block.own.h + OUTPUT_GAP_Y
    for (const n of outputs.get(s.id) ?? []) {
      const size = sizeOf(n)
      if (owns(n.id)) out[n.id] = { x: Math.round(cx - size.w / 2), y: oy }
      oy += size.h + OUTPUT_GAP_Y
    }
  }

  const deepest = Object.entries(out).reduce((low, [id, p]) => {
    const node = byId.get(id)
    return node ? Math.max(low, p.y + sizeOf(node).h) : low
  }, 0)

  // Unattached nodes park in a row underneath, rather than being left where
  // they happened to land.
  let ox = 0
  for (const n of orphans) {
    const s = sizeOf(n)
    if (owns(n.id)) out[n.id] = { x: ox, y: deepest + LEVEL_GAP_Y }
    ox += s.w + SUPPORT_GAP_Y
  }

  // Fixed nodes never moved, so a placed node can still land on one. Nudge the
  // movable ones clear — the user's arrangement wins every time.
  if (movable) {
    const fixedBoxes = nodes.filter((n) => !movable.has(n.id)).map((n) => boxOf(n))
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
