import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { deserializeCanvas, serializeCanvas, type CanvasData } from './persist'
import type { GtNode } from './store'

const session = (id: string, over: Partial<GtNode['data']> = {}): GtNode =>
  ({
    id,
    type: 'session',
    position: { x: 1, y: 2 },
    width: 400,
    height: 320,
    selected: true,
    dragging: true,
    measured: { width: 400, height: 320 },
    data: {
      sessionId: `sess_${id}`,
      provider: 'claude',
      role: 'worker',
      name: id,
      cwd: '/tmp',
      state: 'idle',
      permission: 'auto',
      messages: [],
      usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      skillIds: [],
      ...over,
    },
  }) as GtNode

const snapshot = (nodes: GtNode[], edges: Edge[] = []) => ({
  nodes,
  edges,
  bus: [],
  delivered: {},
  cwd: '/tmp',
})

describe('serializeCanvas', () => {
  it('drops React Flow interaction state but keeps geometry', () => {
    const [n] = serializeCanvas(snapshot([session('a')])).nodes
    expect(n).toMatchObject({ id: 'a', type: 'session', position: { x: 1, y: 2 }, width: 400 })
    expect(n).not.toHaveProperty('selected')
    expect(n).not.toHaveProperty('dragging')
    expect(n).not.toHaveProperty('measured')
  })

  it('never saves a session mid-turn', () => {
    const data = serializeCanvas(snapshot([session('a', { state: 'streaming' })]))
    expect((data.nodes[0].data as { state: string }).state).toBe('idle')
  })

  it('keeps an errored session errored', () => {
    const data = serializeCanvas(snapshot([session('a', { state: 'error' })]))
    expect((data.nodes[0].data as { state: string }).state).toBe('error')
  })

  it('settles pending messages and drops empty ones', () => {
    const messages = [
      { id: 'm1', role: 'user' as const, text: 'hi', tools: [] },
      { id: 'm2', role: 'assistant' as const, text: 'partial', tools: [], pending: true },
      { id: 'm3', role: 'assistant' as const, text: '', tools: [], pending: true },
    ]
    const data = serializeCanvas(snapshot([session('a', { messages })]))
    const saved = (data.nodes[0].data as { messages: typeof messages }).messages
    expect(saved.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(saved.every((m) => m.pending === undefined)).toBe(true)
  })

  it('drops transient call edges and animation timestamps', () => {
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'context', data: { flowing: 123 } },
      { id: 'e2', source: 'a', target: 'b', type: 'call' },
    ]
    const data = serializeCanvas(snapshot([session('a'), session('b')], edges))
    expect(data.edges.map((e) => e.id)).toEqual(['e1'])
    expect(data.edges[0].data).toBeUndefined()
  })

  it('keeps edge data that means something', () => {
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b', type: 'file', data: { write: true } }]
    const data = serializeCanvas(snapshot([session('a'), session('b')], edges))
    expect(data.edges[0].data).toEqual({ write: true })
  })

  it('keeps the write flag but drops the touch timestamp behind it', () => {
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'file', data: { write: true, at: 1700 } },
    ]
    const data = serializeCanvas(snapshot([session('a'), session('b')], edges))
    // `at` drives the live animation; restoring it would show traffic that
    // stopped when the app closed.
    expect(data.edges[0].data).toEqual({ write: true })
  })

  it('drops edges whose endpoints are not on the canvas', () => {
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'gone', type: 'context' }]
    expect(serializeCanvas(snapshot([session('a')], edges)).edges).toEqual([])
  })

  it('flattens delivered sets so the doc is JSON', () => {
    const data = serializeCanvas({ ...snapshot([]), delivered: { s1: new Set(['x', 'y']) } })
    expect(data.delivered).toEqual({ s1: ['x', 'y'] })
    expect(JSON.parse(JSON.stringify(data)).delivered).toEqual({ s1: ['x', 'y'] })
  })
})

describe('deserializeCanvas', () => {
  it('round-trips a canvas', () => {
    const before = {
      ...snapshot([session('a'), session('b')], [
        { id: 'e1', source: 'a', target: 'b', type: 'context' },
      ]),
      delivered: { s1: new Set(['x']) },
    }
    const after = deserializeCanvas(JSON.parse(JSON.stringify(serializeCanvas(before))))
    expect(after.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(after.edges.map((e) => e.id)).toEqual(['e1'])
    expect(after.delivered.s1).toEqual(new Set(['x']))
    expect(after.cwd).toBe('/tmp')
  })

  it('survives a missing or malformed file', () => {
    for (const bad of [null, undefined, {} as CanvasData]) {
      const s = deserializeCanvas(bad)
      expect(s.nodes).toEqual([])
      expect(s.edges).toEqual([])
      expect(s.bus).toEqual([])
      expect(s.delivered).toEqual({})
      expect(s.cwd).toBe('')
    }
  })

  it('skips nodes without an id or type', () => {
    const data = { nodes: [{ id: 'a' }, { type: 'session' }, session('b')] } as unknown as CanvasData
    expect(deserializeCanvas(data).nodes.map((n) => n.id)).toEqual(['b'])
  })

  it('drops edges left dangling by a skipped node', () => {
    const data = {
      nodes: [session('a')],
      edges: [{ id: 'e1', source: 'a', target: 'ghost' }],
    } as unknown as CanvasData
    expect(deserializeCanvas(data).edges).toEqual([])
  })
})
