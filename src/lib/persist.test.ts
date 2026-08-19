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
  autoPlaced: new Set<string>(),
  globalRules: '',
  notifications: [],
  planning: true,
  plan: null,
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

  it('saves the canvas global rules', () => {
    const data = serializeCanvas({ ...snapshot([]), globalRules: 'Never push to main.' })
    expect(data.globalRules).toBe('Never push to main.')
  })

  it('flattens delivered sets so the doc is JSON', () => {
    const data = serializeCanvas({ ...snapshot([]), delivered: { s1: new Set(['x', 'y']) } })
    expect(data.delivered).toEqual({ s1: ['x', 'y'] })
    expect(JSON.parse(JSON.stringify(data)).delivered).toEqual({ s1: ['x', 'y'] })
  })
})

describe('orchestra preferences', () => {
  it('round-trips what the user set', () => {
    const orchestra = { provider: 'codex' as const, heavy: 'gpt-5', mid: null, light: null }
    const back = deserializeCanvas(serializeCanvas({ ...snapshot([]), orchestra }))
    expect(back.orchestra).toEqual(orchestra)
  })

  it('opens a canvas saved before it existed with no preference', () => {
    const back = deserializeCanvas({ ...serializeCanvas(snapshot([])), orchestra: undefined })
    expect(back.orchestra).toEqual({ provider: null, heavy: null, mid: null, light: null })
  })

  it('drops a provider the app does not have', () => {
    // A provider this build has never heard of, as a hand-edited file would
    // carry it — hence the cast through unknown.
    const data = {
      ...serializeCanvas(snapshot([])),
      orchestra: { provider: 'gemini' },
    } as unknown as CanvasData
    expect(deserializeCanvas(data).orchestra?.provider).toBeNull()
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
      // A canvas saved before global rules existed must still open.
      expect(s.globalRules).toBe('')
    }
  })

  it('round-trips the canvas global rules', () => {
    const before = { ...snapshot([session('a')]), globalRules: 'Never push to main.' }
    const after = deserializeCanvas(JSON.parse(JSON.stringify(serializeCanvas(before))))
    expect(after.globalRules).toBe('Never push to main.')
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

describe('plans across a save', () => {
  const plan = {
    fromNodeId: 'a',
    goal: 'ship the export button',
    proposedAt: 1,
    steps: [
      { id: 's1', persona: 'investigator', task: 'look', state: 'done' as const, childId: 'b' },
      { id: 's2', persona: 'implementer', task: 'write', state: 'running' as const },
      { id: 's3', persona: 'reviewer', task: 'check', state: 'pending' as const },
    ],
  }

  /** The agent a running step was waiting on died with the process. Leaving
   *  the step "running" for ever is worse than approving it twice. */
  it('reopens a step that was in flight when the app closed', () => {
    const saved = serializeCanvas({ ...snapshot([session('a')]), plan })
    expect(saved.plan?.steps.map((s) => s.state)).toEqual(['done', 'pending', 'pending'])
    const back = deserializeCanvas(saved)
    expect(back.plan?.steps.map((s) => s.state)).toEqual(['done', 'pending', 'pending'])
    expect(back.plan?.steps[0].childId).toBe('b')
    expect(back.plan?.goal).toBe('ship the export button')
  })

  it('keeps planning on for a canvas saved before it existed', () => {
    const back = deserializeCanvas({ ...serializeCanvas(snapshot([])), planning: undefined })
    expect(back.planning).toBe(true)
    expect(back.plan).toBeNull()
  })

  it('survives a canvas whose plan is junk', () => {
    const back = deserializeCanvas({
      ...serializeCanvas(snapshot([])),
      plan: { fromNodeId: 'a', goal: '', proposedAt: 0, steps: [] },
    })
    expect(back.plan).toBeNull()
  })
})

describe('image attachments on a message', () => {
  const withImages = [
    { id: 'm1', role: 'user' as const, text: 'what is wrong', tools: [], images: ['/tmp/a.png'] },
    { id: 'm2', role: 'assistant' as const, text: 'the margin', tools: [] },
  ]

  it('survives the round trip, and only where it was set', () => {
    const data = serializeCanvas(snapshot([session('a', { messages: withImages })]))
    const back = deserializeCanvas(data).nodes[0]
    const messages = back.type === 'session' ? back.data.messages : []
    expect(messages[0].images).toEqual(['/tmp/a.png'])
    expect('images' in messages[1]).toBe(false)
  })

  /** Every canvas saved before images existed is one of these. */
  it('loads a canvas whose messages predate the field', () => {
    const messages = [{ id: 'm1', role: 'user' as const, text: 'hello', tools: [] }]
    const back = deserializeCanvas(serializeCanvas(snapshot([session('a', { messages })]))).nodes[0]
    const loaded = back.type === 'session' ? back.data.messages : []
    expect(loaded).toEqual(messages)
    expect(loaded[0].images).toBeUndefined()
  })
})
