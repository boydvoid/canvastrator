import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { boxOf, findFreeSpot, layoutCanvas, sizeOf } from './layout'
import type { GtNode } from './store'

const session = (id: string, x = 0, y = 0): GtNode =>
  ({ id, type: 'session', position: { x, y }, width: 260, height: 64, data: {} }) as never
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
  it('puts a folder in front of its session and the files after it', () => {
    const nodes = [session('s1'), folder('f1'), file('a'), file('b')]
    const edges = [
      edge('f1', 's1', 'cwd'),
      edge('s1', 'a', 'file'),
      edge('s1', 'b', 'file'),
    ]
    const p = layoutCanvas(nodes, edges)
    // What was wired in enters on the left; what the agent touched leaves right.
    expect(p.f1.x + 256).toBeLessThanOrEqual(p.s1.x)
    expect(p.a.x).toBeGreaterThan(p.s1.x + 260)
    expect(p.b.y).toBeGreaterThan(p.a.y)
    expect(p.b.x).toBe(p.a.x)
    assertNoOverlaps(nodes, p)
  })

  it('grids a session\'s files rather than running them off the bottom', () => {
    const nodes = [session('s1'), ...Array.from({ length: 8 }, (_, i) => file(`f${i}`))]
    const edges = nodes.slice(1).map((n) => edge('s1', n.id, 'file'))
    const p = layoutCanvas(nodes, edges)
    const ys = nodes.slice(1).map((n) => p[n.id].y)
    const xs = nodes.slice(1).map((n) => p[n.id].x)
    // Eight files go two wide and four deep, not eight deep — a column that
    // long pushes the next agent's whole strip off the screen.
    expect(new Set(xs).size).toBe(2)
    expect(new Set(ys).size).toBe(4)
    assertNoOverlaps(nodes, p)
  })

  it('keeps a couple of files in a plain column under the agent', () => {
    const nodes = [session('s1'), file('a'), file('b')]
    const edges = [edge('s1', 'a', 'file'), edge('s1', 'b', 'file')]
    const p = layoutCanvas(nodes, edges)
    expect(p.a.x).toBe(p.b.x)
    expect(p.b.y).toBeGreaterThan(p.a.y)
    assertNoOverlaps(nodes, p)
  })

  it('hangs a spawned child to the right of its parent, not under it', () => {
    const nodes = [session('parent'), session('child')]
    const edges = [edge('parent', 'child', 'spawn')]
    const p = layoutCanvas(nodes, edges)
    expect(p.child.x).toBeGreaterThan(p.parent.x + 260)
    // An only child sits level with its parent.
    expect(p.child.y).toBe(p.parent.y)
    assertNoOverlaps(nodes, p)
  })

  /** The shape of a horizontal flow: one orchestrator, a column of agents to
   *  its right. */
  it('stacks siblings in a column and centres the parent against them', () => {
    const nodes = [session('orch'), session('a'), session('b'), session('c')]
    const edges = ['a', 'b', 'c'].map((c) => edge('orch', c, 'spawn'))
    const p = layoutCanvas(nodes, edges)

    // All three in the same column, top to bottom, right of the orchestrator.
    expect(p.a.x).toBe(p.b.x)
    expect(p.b.x).toBe(p.c.x)
    expect(p.a.x).toBeGreaterThan(p.orch.x + 260)
    expect(p.a.y).toBeLessThan(p.b.y)
    expect(p.b.y).toBeLessThan(p.c.y)

    // The orchestrator sits against the middle of the column.
    const colCentre = (p.a.y + p.c.y + 64) / 2
    expect(Math.abs(p.orch.y + 32 - colCentre)).toBeLessThanOrEqual(1)
    assertNoOverlaps(nodes, p)
  })

  it('keeps each agent\'s files in that agent\'s own strip', () => {
    const nodes = [session('orch'), session('a'), session('b'), file('af'), file('bf')]
    const edges = [
      edge('orch', 'a', 'spawn'),
      edge('orch', 'b', 'spawn'),
      edge('a', 'af', 'file'),
      edge('b', 'bf', 'file'),
    ]
    const p = layoutCanvas(nodes, edges)
    // Off its own agent's right, level with it, and clear of the next strip.
    expect(p.af.x).toBeGreaterThan(p.a.x + 260)
    expect(p.bf.x).toBeGreaterThan(p.b.x + 260)
    expect(Math.abs(p.af.y + 19 - (p.a.y + 32))).toBeLessThanOrEqual(1)
    expect(p.af.y).toBeLessThan(p.b.y)
    assertNoOverlaps(nodes, p)
  })

  it('puts a server\'s tool nodes between it and the agent, not in the orphan row', () => {
    const nodes: GtNode[] = [
      session('s1'),
      { id: 'mcp1', type: 'mcp', position: { x: 0, y: 0 }, data: {} } as never,
      { id: 'tool1', type: 'mcptool', position: { x: 0, y: 0 }, data: {} } as never,
    ]
    const edges = [edge('mcp1', 's1', 'attach'), edge('mcp1', 'tool1', 'mcpuse')]
    const p = layoutCanvas(nodes, edges)
    // Server, then its tools, then the agent they were called from.
    expect(p.tool1.x).toBeGreaterThan(p.mcp1.x)
    expect(p.tool1.x).toBeLessThan(p.s1.x)
    assertNoOverlaps(nodes, p)
  })

  /**
   * Pins the dagre ordering workaround. If a dagre upgrade stops reversing
   * sibling order, this fails rather than silently mirroring every canvas.
   */
  it('orders siblings by spawn order, top to bottom', () => {
    const kids = ['a', 'b', 'c', 'd', 'e']
    const nodes = [session('orch'), ...kids.map((k) => session(k))]
    const edges = kids.map((k) => edge('orch', k, 'spawn'))
    const p = layoutCanvas(nodes, edges)
    const byY = [...kids].sort((l, r) => p[l].y - p[r].y)
    expect(byY).toEqual(kids)
  })

  it('keeps a grandchild beside its own parent, not the orchestrator', () => {
    const nodes = ['orch', 'a', 'b', 'a1', 'a2'].map((id) => session(id))
    const edges = [
      edge('orch', 'a', 'spawn'),
      edge('orch', 'b', 'spawn'),
      edge('a', 'a1', 'spawn'),
      edge('a', 'a2', 'spawn'),
    ]
    const p = layoutCanvas(nodes, edges)
    expect(p.a1.x).toBeGreaterThan(p.a.x + 260)
    expect(p.a1.y).toBeLessThan(p.a2.y)
    // `a` sits against the middle of its own two children.
    expect(Math.abs(p.a.y - (p.a1.y + p.a2.y) / 2)).toBeLessThanOrEqual(1)
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
    const taken = [{ x: 0, y: 0, w: 196, h: 38 }]
    const spot = findFreeSpot({ x: 0, y: 0, w: 196, h: 38 }, taken)
    expect(spot.y).toBeGreaterThanOrEqual(38)
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
    // The helper hands sessions a measured size; strip it to see the fallback.
    const measured = session('s', 0, 0)
    expect(sizeOf(measured)).toEqual({ w: 260, h: 64 })
    expect(sizeOf({ ...measured, width: undefined, height: undefined } as GtNode)).toEqual({
      w: 260,
      h: 106,
    })
    expect(sizeOf(file('f'))).toEqual({ w: 196, h: 38 })
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
    // Off the session's real position, not the layout's idea of it.
    expect(placed.f.x).toBeGreaterThan(1000 + 260)
    // Level with the session's own centre line, not the layout's.
    expect(placed.f.y).toBe(2000 + (64 - 38) / 2)
  })

  it('moves an agent node clear of a user node it would have landed on', () => {
    const nodes = [session('s1', 0, 0), file('blocker', 316, 13), file('f', 0, 0)]
    const edges = [edge('s1', 'f', 'file')]
    const placed = layoutCanvas(nodes, edges, new Set(['f']))
    const b = boxOf(nodes[1])
    const hit =
      placed.f.x < b.x + b.w && placed.f.x + 196 > b.x && placed.f.y < b.y + b.h && placed.f.y + 38 > b.y
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
