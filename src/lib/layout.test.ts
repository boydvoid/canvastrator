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
  it('puts a folder left of its session and files right of it', () => {
    const nodes = [session('s1'), folder('f1'), file('a'), file('b')]
    const edges = [
      edge('f1', 's1', 'cwd'),
      edge('s1', 'a', 'file'),
      edge('s1', 'b', 'file'),
    ]
    const p = layoutCanvas(nodes, edges)
    expect(p.f1.x).toBeLessThan(p.s1.x)
    expect(p.a.x).toBeGreaterThan(p.s1.x)
    expect(p.b.x).toBeGreaterThan(p.s1.x)
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

  it('hangs spawned children below and indented from their parent', () => {
    const nodes = [session('parent'), session('child')]
    const edges = [edge('parent', 'child', 'spawn')]
    const p = layoutCanvas(nodes, edges)
    expect(p.child.y).toBeGreaterThan(p.parent.y + 340)
    expect(p.child.x).toBeGreaterThan(p.parent.x)
    assertNoOverlaps(nodes, p)
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
    // To the right of the session's real position, not the layout's idea of it.
    expect(placed.f.x).toBeGreaterThan(1000)
    expect(placed.f.y).toBeGreaterThanOrEqual(2000)
  })

  it('moves an agent node clear of a user node it would have landed on', () => {
    const nodes = [session('s1', 0, 0), file('blocker', 490, 0), file('f', 0, 0)]
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
