import dagre from '@dagrejs/dagre'
import type { Edge } from '@xyflow/react'
import { DENSITY_SIZE } from './density'
import { pattern as patternOf } from './patterns'
import type { GtNode } from './store'
import type { Plan } from './types'

/**
 * Laying out a Canvastrator canvas is not a generic graph problem — the graph
 * has a grammar, and it is the grammar of a flow chart read left to right:
 *
 *                          skill ┐              ┌ file  file
 *                                 ├─┤ agent ├────┤
 *   ┌────────┐     ┌──────────┐   │              └ file  file
 *   │ folder ├─────┤ orchestr ├───┤
 *   └────────┘     └──────────┘   │              ┌ file
 *                           mcp ┐ ├─┤ agent ├────┤
 *                                                └ file
 *
 * Everything moves one way: in on the left, out on the right. The orchestrator
 * sits at the front, agents it spawned stack in a column to its right, and each
 * agent's own strip repeats the rule — what was wired in to set it up (folder,
 * skills, MCP servers, attached files) enters from its left, and the files it
 * touched hang off its right.
 *
 * A support wired into *several* agents — the repo folder, usually — belongs to
 * none of their strips: it goes in a column of its own in front of everything
 * it feeds, which is where a flow chart puts its input.
 *
 * Files go in a *grid*, not a column. A busy agent touches ten files, and ten
 * file nodes in a line is 900px of strip that pushes the next agent that far
 * down — the canvas becomes one endless vertical scroll, which is the thing
 * the horizontal flow exists to avoid.
 *
 * Dagre does the hard half — ranking the agent tree, ordering each rank to
 * minimise crossings, and centring a parent against its children. Hand-rolling
 * that is how the old layout got into trouble: every new case needed another
 * correction to the size arithmetic, and they disagreed with each other.
 *
 * So only the *tree* goes to dagre. Each agent's strip — its supports, itself,
 * and its column of files — is measured and handed over as a single node, and
 * the contents are placed inside that node's box afterwards. Dagre never sees a
 * file, which is what keeps files in a strip under their agent instead of
 * fanned across a rank as siblings.
 *
 * The one thing that is *not* generic: when a plan is running, the shape it
 * declared decides how its agents are ranked. A fan-out puts them in one
 * column beside the orchestrator, because they started together; a sequence
 * chains them left to right, because each waited for the one before it. See
 * `sequenceEdges` — the geometry follows how the plan actually runs, not what
 * it was labelled, so a shape the app demoted does not draw a promise the
 * runtime is not keeping.
 *
 * One wrinkle worth knowing: the strip is not symmetric about its session —
 * supports above and files below are rarely the same height. Dagre centres a
 * node against its rank by the *box* it was given, so the box reserves the
 * taller of the two on both sides. That wastes some empty space and buys exact
 * centring in return — the alternative is correcting dagre's output afterwards,
 * which is the trap the previous implementation fell into.
 */

export type Box = { x: number; y: number; w: number; h: number }
export type Placement = Record<string, { x: number; y: number }>

/**
 * The gaps, as a ladder.
 *
 * White space is what says which things belong together, and it can only say
 * that if the gutter *inside* a group is visibly smaller than the gutter
 * around it. The old numbers were 18px between two file chips and 56px between
 * an agent and its files, against nodes 31px tall — three steps of the grammar
 * inside one visual band. Nothing read as a group, so everything read as one
 * clump, and at glance zoom the smallest gutters closed to a hairline.
 *
 * So each rung is comfortably larger than the one it contains: chips in a
 * stack, a server and its tools, an agent and its branches, one strip and the
 * next, one generation and the next. Bigger overall, and the point is not the
 * size — it is that the steps between the rungs are now legible.
 */

/** A session to the supports on its left, and to the files on its right. */
const BRANCH_GAP_X = 96
/** Between two stacked supports, and between two rows of files. */
const STACK_GAP_Y = 26
/** Between two files side by side in the grid beside an agent. */
const STACK_GAP_X = 26
/** Widest a file grid may get. Past this it pushes the next rank too far
 *  right to read as the same flow. */
const MAX_FILE_COLUMNS = 3
/** Tallest a support stack may get before it takes another column.
 *
 *  A session's supports used to stack in one column, and `blockOf` reserves
 *  the taller of the strip's two sides on *both* — so five folders wired into
 *  one agent reserved ~450px above and below a 106px node, and `nodesep`
 *  pushed every sibling that far apart. Wrapping trades that for width, which
 *  under `rankdir: 'LR'` is the axis this layout was chosen to spend. */
const MAX_SUPPORT_ROWS = 3
/** A parent's strip to the column of children beside it — a readable level. */
const LEVEL_GAP_X = 210
/** Between sibling subtrees in a column. */
const SIBLING_GAP_Y = 110
/** Between an MCP server and the grid of tool nodes it feeds. */
const SATELLITE_GAP_X = 44
/**
 * Tallest a server's tool grid may get before it takes another column.
 *
 * Eleven tools in one column is 800px of canvas hanging off one server — it
 * sets the height of everything near it, and every other group ends up read
 * against that. Same trade as `MAX_SUPPORT_ROWS`, for the same reason: under
 * `rankdir: 'LR'` width is the axis this layout has to spend.
 */
const MAX_SATELLITE_ROWS = 4

/**
 * The box the layout assumes an agent needs.
 *
 * A hint, not a rule: agent nodes size themselves from their own density and
 * content now, so the real box comes from what React Flow measured. This is
 * what to assume for a node that has never been rendered — a step in a plan,
 * or a child placed the instant it is spawned.
 */
export const SESSION_SIZE = DENSITY_SIZE.summary
/** A file is a chip. There are a lot of them, and they stack. */
export const FILE_SIZE = { w: 196, h: 38 }

/** A terminal is a label with a line of its last output under it. */
export const TERMINAL_SIZE = { w: 240, h: 64 }

/** The Changes list. A row per file written, so it grows with the run. */
export const CHANGES_SIZE = { w: 330, h: 260 }

/** Fallback sizes for nodes React Flow hasn't measured yet. */
const DEFAULT_SIZE: Record<GtNode['type'], { w: number; h: number }> = {
  session: SESSION_SIZE,
  file: FILE_SIZE,
  folder: { w: 256, h: 76 },
  skill: { w: 240, h: 190 },
  mcp: { w: 240, h: 150 },
  mcptool: { w: 208, h: 52 },
  changes: CHANGES_SIZE,
  terminal: TERMINAL_SIZE,
}

/**
 * How big a node actually is.
 *
 * Declared size first, because a node given one is meant to hold it. Then
 * whatever React Flow measured, which is the truth for every node that sizes
 * itself from its content — agent nodes, since they gained densities, and the
 * modules. The nominal table is the last resort: a node placed before it has
 * ever been on screen has nothing else to go on.
 */
export const sizeOf = (n: GtNode) => ({
  w: (n.width as number | undefined) ?? n.measured?.width ?? DEFAULT_SIZE[n.type]?.w ?? 240,
  h: (n.height as number | undefined) ?? n.measured?.height ?? DEFAULT_SIZE[n.type]?.h ?? 120,
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
  /** session id → files it touched, in reading order */
  outputs: Map<string, GtNode[]>
  /** session id → folder / skills / servers / files wired into it alone */
  supports: Map<string, Support[]>
  /** supports feeding more than one session, with everything they feed */
  shared: Array<Support & { targets: string[] }>
  /** session id → child session ids, by spawn edge */
  children: Map<string, string[]>
  orphans: GtNode[]
}

function group(nodes: GtNode[], edges: Edge[]): Groups {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const sessions = nodes.filter((n) => n.type === 'session')

  const outFiles = new Map<string, GtNode[]>()
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
    // anything → session: a support, sitting above it.
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

  const outputs = new Map<string, GtNode[]>()
  for (const s of sessions) {
    const mine = outFiles.get(s.id) ?? []
    if (mine.length) outputs.set(s.id, mine)
  }

  // A support wired into several sessions can't live in any one strip — put it
  // in front of all of them instead.
  const fedBy = new Map<string, string[]>()
  for (const [sessionId, list] of supportOf) {
    for (const node of list) push(fedBy, node.id, sessionId)
  }

  const supports = new Map<string, Support[]>()
  for (const [id, list] of supportOf) {
    const mine = list
      .filter((node) => (fedBy.get(node.id) ?? []).length < 2)
      .map((node) => ({ node, kids: kidsOf.get(node.id) ?? [] }))
    if (mine.length) supports.set(id, mine)
  }

  const seen = new Set<string>()
  const shared: Groups['shared'] = []
  for (const list of supportOf.values()) {
    for (const node of list) {
      const targets = fedBy.get(node.id) ?? []
      if (targets.length < 2 || seen.has(node.id)) continue
      seen.add(node.id)
      shared.push({ node, kids: kidsOf.get(node.id) ?? [], targets })
    }
  }

  return {
    outputs,
    supports,
    shared,
    children,
    // Nodes attached to nothing still need somewhere to go.
    orphans: nodes.filter((n) => n.type !== 'session' && !claimed.has(n.id)),
  }
}

/**
 * The tool nodes a server feeds, wrapped into columns that grow away from it.
 *
 * Column-major, so reading order runs down the column nearest the server
 * first — the same rule the support grid follows, and for the same reason.
 */
function satelliteGrid(kids: GtNode[]) {
  const boxes = kids.map(sizeOf)
  const cols = Math.max(1, Math.ceil(boxes.length / MAX_SATELLITE_ROWS))
  const rows = Math.max(1, Math.ceil(boxes.length / cols))
  const cellOf = (i: number) => ({ col: Math.floor(i / rows), row: i % rows })
  const rowH = Array.from({ length: rows }, (_, r) =>
    Math.max(0, ...boxes.filter((_, i) => cellOf(i).row === r).map((b) => b.h)),
  )
  const colW = Array.from({ length: cols }, (_, c) =>
    Math.max(0, ...boxes.filter((_, i) => cellOf(i).col === c).map((b) => b.w)),
  )
  return {
    boxes,
    cellOf,
    rowH,
    colW,
    w: boxes.length ? stackHeight(colW, STACK_GAP_X) : 0,
    h: boxes.length ? stackHeight(rowH, STACK_GAP_Y) : 0,
  }
}

/**
 * Place a server's tools in the lane between it and the agent they serve,
 * centred on the server's own middle line.
 */
function placeSatellites(
  kids: GtNode[],
  laneLeft: number,
  centre: number,
  put: (id: string, at: { x: number; y: number }) => void,
) {
  if (!kids.length) return
  const grid = satelliteGrid(kids)
  const top = centre - grid.h / 2
  const rowTop = grid.rowH.map((_, r) =>
    grid.rowH.slice(0, r).reduce((sum, h) => sum + h + STACK_GAP_Y, top),
  )
  const colLeft = grid.colW.map((_, c) =>
    grid.colW.slice(0, c).reduce((x, w) => x + w + STACK_GAP_X, laneLeft),
  )
  kids.forEach((kid, i) => {
    const { col, row } = grid.cellOf(i)
    put(kid.id, {
      x: Math.round(colLeft[col]),
      y: Math.round(rowTop[row] + (grid.rowH[row] - grid.boxes[i].h) / 2),
    })
  })
}

/** How much room a support and the tool nodes it feeds need, together. */
function supportSize(s: Support) {
  const own = sizeOf(s.node)
  if (!s.kids.length) return { w: own.w, h: own.h }
  const kids = satelliteGrid(s.kids)
  // The tools sit in the lane between the server and the agent, so the cluster
  // is as wide as both and as tall as the taller of them.
  return { w: own.w + SATELLITE_GAP_X + kids.w, h: Math.max(own.h, kids.h) }
}

/**
 * Shape of the file grid beside an agent: near-square, capped in width. Four
 * deep before it takes a second column, so the common case — an agent that
 * touched one or two files — is still a plain little column beside the node.
 */
const gridCols = (n: number) => Math.max(1, Math.min(MAX_FILE_COLUMNS, Math.ceil(n / 4)))

/**
 * The supports beside an agent, wrapped into columns that grow away from it.
 *
 * Rows and columns are measured individually rather than on a uniform cell: a
 * skill node is two and a half times a folder's height, and squaring the grid
 * off against the tallest member would give back the height the wrap just
 * saved. At three or fewer supports this is the single right-aligned column it
 * has always been.
 */
function supportGrid(items: Support[]) {
  const boxes = items.map(supportSize)
  const cols = Math.max(1, Math.ceil(boxes.length / MAX_SUPPORT_ROWS))
  const rows = Math.max(1, Math.ceil(boxes.length / cols))
  // Column-major: a column fills top to bottom before the next one starts, so
  // reading order runs down the column nearest the agent first.
  const cellOf = (i: number) => ({ col: Math.floor(i / rows), row: i % rows })
  const rowH = Array.from({ length: rows }, (_, r) =>
    Math.max(0, ...boxes.filter((_, i) => cellOf(i).row === r).map((b) => b.h)),
  )
  const colW = Array.from({ length: cols }, (_, c) =>
    Math.max(0, ...boxes.filter((_, i) => cellOf(i).col === c).map((b) => b.w)),
  )
  return {
    boxes,
    cols,
    rows,
    rowH,
    colW,
    cellOf,
    w: boxes.length ? stackHeight(colW, STACK_GAP_X) : 0,
    h: boxes.length ? stackHeight(rowH, STACK_GAP_Y) : 0,
  }
}

/** Total height of a vertical stack, including the gaps between its members. */
const stackHeight = (heights: number[], gap: number) =>
  heights.reduce((sum, h) => sum + h, 0) + Math.max(0, heights.length - 1) * gap

/**
 * Arrange the whole canvas. Returns positions rather than nodes so the caller
 * decides how to apply them.
 */
/**
 * The agents a running plan produced, in the order its steps ran.
 *
 * Only for a plan that runs its steps one after another. A fan-out's children
 * genuinely did start together and belong in a column; chaining them would
 * draw a queue that never existed.
 *
 * A shape the app demoted — `plan.warning` — is deliberately not treated as
 * its declared self: the steps are running in order regardless of the label,
 * and the picture must agree with what is happening rather than with what was
 * claimed.
 */
export function sequenceEdges(plan: Plan | null | undefined, byId: Map<string, GtNode>): string[] {
  if (!plan?.pattern) return []
  if (patternOf(plan.pattern.id).run !== 'sequence') return []
  const kids = plan.steps
    .map((step) => step.childId)
    .filter((id): id is string => !!id && byId.get(id)?.type === 'session')
  // A chain of one is a chain in name only, and pairs are what this returns.
  return kids.length >= 2 ? kids : []
}

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
  /**
   * The plans in flight, if any. Each one's shape decides whether the agents
   * it produced read as a column or as a chain — see `sequenceEdges`.
   */
  plans?: Plan[],
): Placement {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const { outputs, supports, shared, children, orphans } = group(nodes, edges)
  const out: Placement = {}
  const owns = (id: string) => !movable || movable.has(id)

  /** Everything a session's strip needs, measured before dagre sees it. */
  const blockOf = (id: string) => {
    const session = byId.get(id)
    const own = session ? sizeOf(session) : DEFAULT_SIZE.session

    const grid = supportGrid(supports.get(id) ?? [])

    const myOutputs = outputs.get(id) ?? []
    const cell = {
      w: Math.max(0, ...myOutputs.map((n) => sizeOf(n).w)),
      h: Math.max(0, ...myOutputs.map((n) => sizeOf(n).h)),
    }
    const cols = gridCols(myOutputs.length)
    const rows = Math.ceil(myOutputs.length / cols)
    const outputsW = myOutputs.length ? cols * cell.w + (cols - 1) * STACK_GAP_X : 0
    const outputsH = myOutputs.length ? rows * cell.h + (rows - 1) * STACK_GAP_Y : 0

    // Supports enter from the left, files leave to the right, and the session
    // holds the middle — so the strip reads the same direction as the flow it
    // sits in rather than doubling back through the top and bottom of a node.
    return {
      own,
      supports: grid,
      outputsH,
      cell,
      cols,
      leftPad: grid.w ? grid.w + BRANCH_GAP_X : 0,
      rightPad: outputsW ? outputsW + BRANCH_GAP_X : 0,
      // Only ever as tall as the strip really is: supports and files are both
      // centred on the session, so the strip is symmetric about it and dagre
      // can keep siblings clear of each other by height alone.
      height: Math.max(own.h, grid.h, outputsH),
    }
  }

  const sessions = nodes.filter((n) => n.type === 'session')

  // ── the tree, by dagre ────────────────────────────────────────────────
  const g = new dagre.graphlib.Graph({ directed: true })
  g.setGraph({
    // Left to right: the flow reads as a pipeline, and a deep spawn tree grows
    // into the direction a wide window actually has room in.
    rankdir: 'LR',
    nodesep: SIBLING_GAP_Y,
    ranksep: LEVEL_GAP_X,
    marginx: 0,
    marginy: 0,
  })
  g.setDefaultEdgeLabel(() => ({}))

  const blocks = new Map<string, ReturnType<typeof blockOf>>()
  for (const s of sessions) {
    const block = blockOf(s.id)
    blocks.set(s.id, block)
    // Dagre sees the agent, not its strip. Handing it the whole strip width
    // means every agent in a generation starts at a different x — the one with
    // a wide file grid sits further left — and the column reads as a ragged
    // edge. The strip's own width is packed into the ranks below instead.
    g.setNode(s.id, { width: block.own.w, height: block.height })
  }
  // Reversed on purpose. With no crossings to minimise, dagre's ordering
  // heuristic is free to pick any permutation of a sibling group, and it
  // consistently settles on the reverse of insertion order — so the first agent
  // an orchestrator spawned would end up last. Feeding the edges backwards
  // puts spawn order back top to bottom. `orders siblings by spawn order`
  // in the tests pins this down, so a dagre upgrade that changes the heuristic
  // fails loudly instead of quietly mirroring everyone's canvas.
  const spawnEdges: Array<[string, string]> = []
  for (const [parent, kids] of children) {
    if (!g.hasNode(parent)) continue
    for (const kid of kids) if (g.hasNode(kid)) spawnEdges.push([parent, kid])
  }
  for (const [parent, kid] of spawnEdges.reverse()) g.setEdge(parent, kid)

  // The shape, as ranking. A sequence puts each agent one rank to the right of
  // the one it waited for, so a chain reads left to right instead of stacking
  // into a column that says nothing about the order it ran in. The spawn edges
  // above stay — the orchestrator really did create all of them — and dagre
  // resolves the two constraints together.
  // Per plan: two plans running at once produced two chains, and threading
  // the last agent of one into the first of the other would draw an order
  // nothing ran in.
  for (const plan of plans ?? []) {
    const chain = sequenceEdges(plan, byId)
    for (let i = 1; i < chain.length; i++) {
      if (g.hasNode(chain[i - 1]) && g.hasNode(chain[i])) g.setEdge(chain[i - 1], chain[i])
    }
  }

  // Dagre breaks cycles itself, so a spawn loop can't hang the layout.
  dagre.layout(g)

  // ── ranks packed by hand ──────────────────────────────────────────────
  // Every agent in a rank gets the same x, and a rank starts where the widest
  // strip in the rank before it ended. Dagre decided the ordering and the
  // vertical placement, which is the part that is genuinely hard; spacing
  // columns is arithmetic, and doing it here is what keeps the generations
  // aligned without paying for the widest strip on both sides of every agent.
  const laidX = new Map<string, number>()
  const ranks = new Map<number, string[]>()
  for (const s of sessions) {
    const laid = g.node(s.id) as { x: number } | undefined
    if (!laid) continue
    // Equal widths mean dagre puts a whole rank on one centre line, so the
    // centre *is* the rank key.
    ranks.set(laid.x, [...(ranks.get(laid.x) ?? []), s.id])
  }
  // A support feeding several agents goes in front of them, in a lane of its
  // own — and the lane has to be *reserved* before the ranks are packed. It
  // used to be worked out afterwards, as `leftmost thing I feed, minus one
  // level gap`, which is a space nothing had set aside: a 240px server and its
  // tool grid were dropped into a 150px gutter already occupied by the rank
  // before it, and landed square on top of an agent. Everything downstream of
  // that read as a pile.
  const rankKeys = [...ranks.keys()].sort((a, b) => a - b)
  const rankOf = new Map<string, number>()
  rankKeys.forEach((key, i) => {
    for (const id of ranks.get(key)!) rankOf.set(id, i)
  })

  /** Which lane a shared support belongs in: in front of the first rank it feeds. */
  const laneOf = new Map<string, number>()
  /** How wide that lane has to be: the widest cluster wanting to sit in it. */
  const laneW = new Map<number, number>()
  for (const sup of shared) {
    const ranked = sup.targets.map((t) => rankOf.get(t)).filter((r): r is number => r != null)
    const lane = ranked.length ? Math.min(...ranked) : 0
    laneOf.set(sup.node.id, lane)
    laneW.set(lane, Math.max(laneW.get(lane) ?? 0, supportSize(sup).w))
  }

  /** Where each reserved lane starts, once the packing has walked past it. */
  const laneX = new Map<number, number>()
  let cursor = 0
  rankKeys.forEach((key, i) => {
    const wide = laneW.get(i) ?? 0
    if (wide) {
      laneX.set(i, cursor)
      cursor += wide + LEVEL_GAP_X
    }
    const ids = ranks.get(key)!
    const mine = ids.map((id) => blocks.get(id)!)
    cursor += Math.max(...mine.map((b) => b.leftPad))
    for (const id of ids) laidX.set(id, cursor)
    cursor +=
      Math.max(...mine.map((b) => b.own.w)) +
      Math.max(...mine.map((b) => b.rightPad)) +
      LEVEL_GAP_X
  })

  // ── anchored to whatever the user already placed ──────────────────────
  //
  // Everything above is in a coordinate space of its own, starting at the
  // origin. That is right when the layout owns the whole canvas, and wrong the
  // moment it does not: the orchestrator is the one agent the *user* creates,
  // so it is almost always fixed, and its spawned children were being laid out
  // hundreds of pixels away at the top-left of the canvas with their edges
  // looping back to it. The tree was correct and unreadable — a flow that
  // reads right to left because one end of it never moved.
  //
  // So the computed space is translated onto the fixed agent nearest the root.
  // Its own strip already arranges around where it really is; this puts every
  // generation the layout *does* own into the same frame, to its right.
  // Nearest the root because that is the agent the flow reads from — anchoring
  // on a fixed leaf would push its ancestors off to the left of it, which is
  // the same backwards flow in a subtler form.
  let dx = 0
  let dy = 0
  const anchor = sessions
    .filter((s) => !owns(s.id) && g.hasNode(s.id))
    .sort((a, b) => (laidX.get(a.id) ?? 0) - (laidX.get(b.id) ?? 0))[0]
  if (anchor) {
    const laid = g.node(anchor.id) as { y: number } | undefined
    const block = blocks.get(anchor.id)
    if (laid && block) {
      dx = anchor.position.x - (laidX.get(anchor.id) ?? 0)
      dy = anchor.position.y - Math.round(laid.y - block.own.h / 2)
    }
  }

  // ── the contents of each strip ────────────────────────────────────────
  for (const s of sessions) {
    const block = blocks.get(s.id)!
    const laid = g.node(s.id) as { x: number; y: number } | undefined
    if (!laid) continue

    // A session the user placed anchors its own strip: its supports and files
    // arrange around where it actually is, not where dagre would put it.
    // A session the user placed anchors its own strip: dagre's idea of where
    // the strip belongs is only used for the ones the layout owns.
    const fixed = !owns(s.id)
    const sx = fixed ? s.position.x : Math.round((laidX.get(s.id) ?? laid.x - block.own.w / 2) + dx)
    const sy = fixed ? s.position.y : Math.round(laid.y - block.own.h / 2 + dy)
    // Everything in the strip lines up on the session's own centre line, so a
    // support, its session and the files it produced all read as one row.
    const cy = sy + block.own.h / 2
    if (!fixed) out[s.id] = { x: sx, y: sy }

    // Supports to the left, in columns that grow away from the session, each
    // with its tool nodes beside it.
    const grid = block.supports
    const gridTopY = cy - grid.h / 2
    // Where each row starts and each column ends, accumulated once so the
    // per-support arithmetic below is a lookup.
    const rowTop = grid.rowH.map((_, r) =>
      grid.rowH.slice(0, r).reduce((sum, h) => sum + h + STACK_GAP_Y, gridTopY),
    )
    const colRight = grid.colW.map((_, c) =>
      grid.colW.slice(0, c).reduce((x, w) => x - w - STACK_GAP_X, sx - BRANCH_GAP_X),
    )
    ;(supports.get(s.id) ?? []).forEach((sup, i) => {
      const box = grid.boxes[i]
      const nodeSize = sizeOf(sup.node)
      const { col, row } = grid.cellOf(i)
      // The cluster is right-aligned in its column, so every support in it
      // ends on the same line however wide it is.
      const left = colRight[col] - box.w
      const centre = rowTop[row] + grid.rowH[row] / 2
      if (owns(sup.node.id)) {
        out[sup.node.id] = { x: Math.round(left), y: Math.round(centre - nodeSize.h / 2) }
      }
      // A server's tools go in the lane between it and the agent — still left
      // to right, rather than doubling back under the node.
      placeSatellites(sup.kids, left + nodeSize.w + SATELLITE_GAP_X, centre, (id, at) => {
        if (owns(id)) out[id] = at
      })
    })

    // Outputs in a grid off the session's right, read left to right, so the
    // newest file is the last cell of the last row.
    const myOutputs = outputs.get(s.id) ?? []
    const gridLeft = sx + block.own.w + BRANCH_GAP_X
    const gridTop = Math.round(cy - block.outputsH / 2)
    myOutputs.forEach((n, i) => {
      if (!owns(n.id)) return
      const col = i % block.cols
      const row = Math.floor(i / block.cols)
      out[n.id] = {
        x: gridLeft + col * (block.cell.w + STACK_GAP_X),
        // Each file centred in its own cell, so a short row of chips still
        // lines up with the rows above it.
        y: Math.round(gridTop + row * (block.cell.h + STACK_GAP_Y) + (block.cell.h - sizeOf(n).h) / 2),
      }
    })
  }

  // ── shared supports, in a column in front of the flow ─────────────────
  const placedBox = (id: string): Box | null => {
    const node = byId.get(id)
    if (!node) return null
    return { ...(out[id] ?? node.position), ...sizeOf(node) }
  }

  // Measured against everything already placed, not just against each other:
  // a lane is reserved horizontally, but the agents beside it decide what is
  // free vertically, and a server that lands on one is the whole point of the
  // lane defeated.
  const takenByShared: Box[] = Object.keys(out)
    .map((id) => placedBox(id))
    .filter((b): b is Box => !!b)
  for (const sup of shared) {
    const fed = sup.targets.map(placedBox).filter((b): b is Box => !!b)
    if (!fed.length) continue
    const box = supportSize(sup)
    const nodeSize = sizeOf(sup.node)
    const lane = laneOf.get(sup.node.id)
    const left =
      lane != null && laneX.has(lane)
        ? laneX.get(lane)! + dx
        : Math.min(...fed.map((b) => b.x)) - LEVEL_GAP_X - nodeSize.w
    // Level with the middle of everything it feeds, so its edges fan evenly.
    const centre = fed.reduce((sum, b) => sum + b.y + b.h / 2, 0) / fed.length
    const spot = findFreeSpot(
      { x: left, y: Math.round(centre - box.h / 2), w: box.w, h: box.h },
      takenByShared,
    )
    takenByShared.push({ ...spot, w: box.w, h: box.h })
    if (owns(sup.node.id)) out[sup.node.id] = spot
    placeSatellites(
      sup.kids,
      spot.x + nodeSize.w + SATELLITE_GAP_X,
      spot.y + box.h / 2,
      (id, at) => {
        if (owns(id)) out[id] = at
      },
    )
  }

  const deepest = Object.entries(out).reduce((low, [id, p]) => {
    const node = byId.get(id)
    return node ? Math.max(low, p.y + sizeOf(node).h) : low
  }, 0)

  // Unattached nodes park in a row underneath, rather than being left where
  // they happened to land. Underneath *the flow* — starting at its left edge
  // rather than at the origin, which on an anchored canvas is somewhere off to
  // the side with nothing else near it.
  let ox = Object.entries(out).reduce(
    (left, [id, p]) => (byId.has(id) ? Math.min(left, p.x) : left),
    Number.POSITIVE_INFINITY,
  )
  if (!Number.isFinite(ox)) ox = 0
  for (const n of orphans) {
    const s = sizeOf(n)
    if (owns(n.id)) out[n.id] = { x: ox, y: deepest + BRANCH_GAP_X }
    ox += s.w + STACK_GAP_Y
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
