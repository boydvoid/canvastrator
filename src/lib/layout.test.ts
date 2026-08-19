import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { boxOf, findFreeSpot, layoutCanvas, sizeOf } from './layout'
import type { GtNode } from './store'

const session = (id: string, x = 0, y = 0): GtNode =>
  ({ id, type: 'session', position: { x, y }, width: 400, height: 340, data: {} }) as never
const file = (id: string, x = 0, y = 0): GtNode =>
  ({ id, type: 'file', position: { x, y }, data: {} }) as never
const folder = (id: string): GtNode =>
  ({ id, type: 'folder', position: { x: 0, y: 0 }, data: {} }) as never

const edge = (source: string, target: string, type: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  type,
})

/** No two nodes may occupy the same space — the whole point of the pass. */
function assertNoOverlaps(nodes: GtNode[], placed: Record<string, { x: number; y: number }>) {
  const boxes = nodes.map((n) => ({
    id: n.id,
    ...boxOf({ ...n, position: placed[n.id] ?? n.position } as GtNode),
  }))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const hit =
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
      expect(hit, `${a.id} overlaps ${b.id}`).toBe(false)
    }
  }
}

describe('layoutCanvas', () => {
  it('puts a folder beside its session and the files below it', () => {
    const nodes = [session('s1'), folder('f1'), file('a'), file('b')]
    const edges = [
      edge('f1', 's1', 'cwd'),
      edge('s1', 'a', 'file'),
      edge('s1', 'b', 'file'),
    ]
    const p = layoutCanvas(nodes, edges)
    expect(p.f1.x).toBeLessThan(p.s1.x)
    // Files hang under the agent that touched them, in its column.
    expect(p.a.y).toBeGreaterThan(p.s1.y + 340)
    expect(p.b.y).toBeGreaterThan(p.a.y)
    assertNoOverlaps(nodes, p)
  })

  it('stacks a session\'s files without overlapping them', () => {
    const nodes = [session('s1'), ...Array.from({ length: 8 }, (_, i) => file(`f${i}`))]
    const edges = nodes.slice(1).map((n) => edge('s1', n.id, 'file'))
    const p = layoutCanvas(nodes, edges)
    const ys = nodes.slice(1).map((n) => p[n.id].y)
    expect(new Set(ys).size).toBe(8)
    assertNoOverlaps(nodes, p)
  })

  it('hangs a spawned child below its parent, not beside it', () => {
    const nodes = [session('parent'), session('child')]
    const edges = [edge('parent', 'child', 'spawn')]
    const p = layoutCanvas(nodes, edges)
    expect(p.child.y).toBeGreaterThan(p.parent.y + 340)
    // An only child sits directly under the parent.
    expect(p.child.x).toBe(p.parent.x)
    assertNoOverlaps(nodes, p)
  })

  /** The shape in the reference: one orchestrator, a row of agents beneath. */
  it('spreads siblings across a row and centres the parent over them', () => {
    const nodes = [session('orch'), session('a'), session('b'), session('c')]
    const edges = ['a', 'b', 'c'].map((c) => edge('orch', c, 'spawn'))
    const p = layoutCanvas(nodes, edges)

    // All three on the same row, left to right, below the orchestrator.
    expect(p.a.y).toBe(p.b.y)
    expect(p.b.y).toBe(p.c.y)
    expect(p.a.y).toBeGreaterThan(p.orch.y + 340)
    expect(p.a.x).toBeLessThan(p.b.x)
    expect(p.b.x).toBeLessThan(p.c.x)

    // The orchestrator sits over the middle of the row.
    const rowCentre = (p.a.x + p.c.x + 400) / 2
    expect(Math.abs(p.orch.x + 200 - rowCentre)).toBeLessThanOrEqual(1)
    assertNoOverlaps(nodes, p)
  })

  it('keeps each agent\'s files in that agent\'s own column', () => {
    const nodes = [session('orch'), session('a'), session('b'), file('af'), file('bf')]
    const edges = [
      edge('orch', 'a', 'spawn'),
      edge('orch', 'b', 'spawn'),
      edge('a', 'af', 'file'),
      edge('b', 'bf', 'file'),
    ]
    const p = layoutCanvas(nodes, edges)
    // Centred under its own agent, and clear of the neighbouring column.
    expect(Math.abs(p.af.x + 112 - (p.a.x + 200))).toBeLessThanOrEqual(1)
    expect(Math.abs(p.bf.x + 112 - (p.b.x + 200))).toBeLessThanOrEqual(1)
    expect(p.af.x).toBeLessThan(p.b.x)
    assertNoOverlaps(nodes, p)
  })

  it('tucks a server\'s tool nodes under the server, not in the orphan row', () => {
    const nodes: GtNode[] = [
      session('s1'),
      { id: 'mcp1', type: 'mcp', position: { x: 0, y: 0 }, data: {} } as never,
      { id: 'tool1', type: 'mcptool', position: { x: 0, y: 0 }, data: {} } as never,
    ]
    const edges = [edge('mcp1', 's1', 'attach'), edge('mcp1', 'tool1', 'mcpuse')]
    const p = layoutCanvas(nodes, edges)
    expect(p.tool1.y).toBeGreaterThan(p.mcp1.y)
    expect(p.tool1.x).toBeGreaterThanOrEqual(p.mcp1.x)
    expect(p.tool1.x).toBeLessThan(p.s1.x)
    assertNoOverlaps(nodes, p)
  })

  /**
   * Pins the dagre ordering workaround. If a dagre upgrade stops reversing
   * sibling order, this fails rather than silently mirroring every canvas.
   */
  it('orders siblings by spawn order, left to right', () => {
    const kids = ['a', 'b', 'c', 'd', 'e']
    const nodes = [session('orch'), ...kids.map((k) => session(k))]
    const edges = kids.map((k) => edge('orch', k, 'spawn'))
    const p = layoutCanvas(nodes, edges)
    const byX = [...kids].sort((l, r) => p[l].x - p[r].x)
    expect(byX).toEqual(kids)
  })

  it('keeps a grandchild under its own parent, not the orchestrator', () => {
    const nodes = ['orch', 'a', 'b', 'a1', 'a2'].map((id) => session(id))
    const edges = [
      edge('orch', 'a', 'spawn'),
      edge('orch', 'b', 'spawn'),
      edge('a', 'a1', 'spawn'),
      edge('a', 'a2', 'spawn'),
    ]
    const p = layoutCanvas(nodes, edges)
    expect(p.a1.y).toBeGreaterThan(p.a.y + 340)
    expect(p.a1.x).toBeLessThan(p.a2.x)
    // `a` sits over the middle of its own two children.
    expect(Math.abs(p.a.x - (p.a1.x + p.a2.x) / 2)).toBeLessThanOrEqual(1)
    assertNoOverlaps(nodes, p)
  })

  it('does not recurse forever on a spawn cycle', () => {
    const nodes = [session('a'), session('b')]
    const edges = [edge('a', 'b', 'spawn'), edge('b', 'a', 'spawn')]
    expect(() => layoutCanvas(nodes, edges)).not.toThrow()
  })

  it('keeps a whole squad clear of itself', () => {
    const nodes: GtNode[] = [session('orch'), folder('repo')]
    const edges: Edge[] = [edge('repo', 'orch', 'cwd')]
    for (let c = 0; c < 3; c++) {
      nodes.push(session(`child${c}`))
      edges.push(edge('orch', `child${c}`, 'spawn'))
      for (let f = 0; f < 4; f++) {
        nodes.push(file(`c${c}f${f}`))
        edges.push(edge(`child${c}`, `c${c}f${f}`, 'file'))
      }
    }
    assertNoOverlaps(nodes, layoutCanvas(nodes, edges))
  })

  it('parks unattached nodes instead of leaving them where they fell', () => {
    const nodes = [session('s1'), file('loose', 9999, 9999)]
    const p = layoutCanvas(nodes, [])
    expect(p.loose).toBeDefined()
    expect(p.loose.x).toBeLessThan(9999)
    assertNoOverlaps(nodes, p)
  })

  it('handles an empty canvas and dangling edges', () => {
    expect(layoutCanvas([], [])).toEqual({})
    expect(() => layoutCanvas([session('s1')], [edge('ghost', 's1', 'cwd')])).not.toThrow()
  })
})

describe('findFreeSpot', () => {
  it('leaves a clear spot alone', () => {
    const spot = findFreeSpot({ x: 0, y: 0, w: 100, h: 100 }, [{ x: 500, y: 500, w: 100, h: 100 }])
    expect(spot).toEqual({ x: 0, y: 0 })
  })

  /** The bug in the screenshot: a new file node landed on top of an existing one. */
  it('moves clear of a node already there', () => {
    const taken = [{ x: 0, y: 0, w: 224, h: 64 }]
    const spot = findFreeSpot({ x: 0, y: 0, w: 224, h: 64 }, taken)
    expect(spot.y).toBeGreaterThanOrEqual(64)
  })

  it('keeps the x it was given', () => {
    const taken = [{ x: 0, y: 0, w: 224, h: 64 }]
    expect(findFreeSpot({ x: 300, y: 0, w: 224, h: 64 }, taken).x).toBe(300)
  })

  it('terminates on a densely packed column', () => {
    const taken = Array.from({ length: 300 }, (_, i) => ({ x: 0, y: i * 80, w: 224, h: 64 }))
    expect(() => findFreeSpot({ x: 0, y: 0, w: 224, h: 64 }, taken)).not.toThrow()
  })
})

describe('sizeOf', () => {
  it('prefers a measured size, falls back per node type', () => {
    expect(sizeOf(session('s', 0, 0))).toEqual({ w: 400, h: 340 })
    expect(sizeOf(file('f'))).toEqual({ w: 224, h: 64 })
  })
})

describe('layoutCanvas — ownership', () => {
  /** The rule: the layout only moves what an agent placed. */
  it('leaves a user-placed node exactly where it is', () => {
    const nodes = [session('s1', 1234, 5678), file('agentFile', 0, 0)]
    const edges = [edge('s1', 'agentFile', 'file')]
    const placed = layoutCanvas(nodes, edges, new Set(['agentFile']))
    expect(placed.s1).toBeUndefined()
    expect(placed.agentFile).toBeDefined()
  })

  it('anchors an agent node to where the user put its session', () => {
    const nodes = [session('s1', 1000, 2000), file('f', 0, 0)]
    const edges = [edge('s1', 'f', 'file')]
    const placed = layoutCanvas(nodes, edges, new Set(['f']))
    // Below the session's real position, not the layout's idea of it.
    expect(placed.f.y).toBeGreaterThan(2000 + 340)
    expect(placed.f.x).toBeGreaterThanOrEqual(1000)
  })

  it('moves an agent node clear of a user node it would have landed on', () => {
    const nodes = [session('s1', 0, 0), file('blocker', 88, 368), file('f', 0, 0)]
    const edges = [edge('s1', 'f', 'file')]
    const placed = layoutCanvas(nodes, edges, new Set(['f']))
    const b = boxOf(nodes[1])
    const hit =
      placed.f.x < b.x + b.w && placed.f.x + 224 > b.x && placed.f.y < b.y + b.h && placed.f.y + 64 > b.y
    expect(hit, 'agent node overlaps the user-placed one').toBe(false)
  })

  it('moves everything when ownership is not given — the explicit tidy', () => {
    const nodes = [session('s1', 1234, 5678), file('f', 0, 0)]
    const placed = layoutCanvas(nodes, [edge('s1', 'f', 'file')])
    expect(placed.s1).toBeDefined()
    expect(placed.f).toBeDefined()
  })

  it('moves nothing when the layout owns nothing', () => {
    const nodes = [session('s1', 10, 20), file('f', 30, 40)]
    const placed = layoutCanvas(nodes, [edge('s1', 'f', 'file')], new Set())
    expect(Object.keys(placed)).toEqual([])
  })
})
