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
  plans: [],
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

describe('the floating panels', () => {
  it('round-trips which are open and which are folded away', () => {
    const panels = {
      pulse: { open: true, minimized: false },
      decisions: { open: true, minimized: false },
      shared: { open: false, minimized: false },
      changes: { open: false, minimized: true },
      usage: { open: true, minimized: true },
      skills: { open: true, minimized: false },
      personas: { open: false, minimized: false },
    }
    const back = deserializeCanvas(
      JSON.parse(JSON.stringify(serializeCanvas({ ...snapshot([]), panels }))),
    )
    expect(back.panels).toEqual(panels)
  })

  it('opens a canvas saved before they existed with nothing showing', () => {
    const back = deserializeCanvas({ ...serializeCanvas(snapshot([])), panels: undefined })
    expect(back.panels).toEqual({
      pulse: { open: false, minimized: false },
      decisions: { open: false, minimized: false },
      shared: { open: false, minimized: false },
      changes: { open: false, minimized: false },
      usage: { open: false, minimized: false },
      skills: { open: false, minimized: false },
      personas: { open: false, minimized: false },
    })
  })

  it('ignores a panel this build does not have, and a flag that is not one', () => {
    // As a hand-edited file, or one from a build that knew a panel this one
    // does not, would carry it — hence the cast through unknown.
    const data = {
      ...serializeCanvas(snapshot([])),
      panels: { pulse: { open: 'yes' }, weather: { open: true } },
    } as unknown as CanvasData
    const panels = deserializeCanvas(data).panels
    expect(panels?.pulse).toEqual({ open: false, minimized: false })
    expect(panels).not.toHaveProperty('weather')
  })

  it('drops Pulse and Usage nodes from a canvas saved while they were nodes', () => {
    const data = {
      nodes: [
        session('a'),
        { id: 'p1', type: 'pulse', position: { x: 0, y: 0 }, data: { pulseId: 'pulse_1' } },
        { id: 'u1', type: 'usage', position: { x: 0, y: 0 }, data: { usageId: 'usage_1' } },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'p1', type: 'context' }],
    } as unknown as CanvasData
    const after = deserializeCanvas(data)
    expect(after.nodes.map((n) => n.id)).toEqual(['a'])
    expect(after.edges).toEqual([])
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
    id: 'plan1',
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
    const saved = serializeCanvas({ ...snapshot([session('a')]), plans: [plan] })
    expect(saved.plans?.[0]?.steps.map((s) => s.state)).toEqual(['done', 'pending', 'pending'])
    const back = deserializeCanvas(saved)
    expect(back.plans[0]?.steps.map((s) => s.state)).toEqual(['done', 'pending', 'pending'])
    expect(back.plans[0]?.steps[0].childId).toBe('b')
    expect(back.plans[0]?.goal).toBe('ship the export button')
  })

  it('keeps every plan the canvas had, in the order they were proposed', () => {
    const second = { ...plan, id: 'plan2', goal: 'fix the import path' }
    const back = deserializeCanvas(serializeCanvas({ ...snapshot([session('a')]), plans: [plan, second] }))
    expect(back.plans.map((p) => p.goal)).toEqual(['ship the export button', 'fix the import path'])
  })

  /** Every canvas saved before an orchestrator could hold two jobs. */
  it('reads the single plan a canvas saved before there were several', () => {
    const back = deserializeCanvas({
      ...serializeCanvas(snapshot([])),
      plans: undefined,
      plan: { ...plan, id: '' },
    } as unknown as CanvasData)
    expect(back.plans).toHaveLength(1)
    expect(back.plans[0].goal).toBe('ship the export button')
    // Named on the way in, because everything downstream acts on a plan by id.
    expect(back.plans[0].id).toBeTruthy()
  })

  it('keeps planning on for a canvas saved before it existed', () => {
    const back = deserializeCanvas({ ...serializeCanvas(snapshot([])), planning: undefined })
    expect(back.planning).toBe(true)
    expect(back.plans).toEqual([])
  })

  it('survives a canvas whose plan is junk', () => {
    const back = deserializeCanvas({
      ...serializeCanvas(snapshot([])),
      plans: [{ id: 'p', fromNodeId: 'a', goal: '', proposedAt: 0, steps: [] }],
    })
    expect(back.plans).toEqual([])
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

describe('worktree isolation', () => {
  it('round-trips the rule', () => {
    const back = deserializeCanvas(
      JSON.parse(JSON.stringify(serializeCanvas({ ...snapshot([]), isolateSpawns: true }))),
    )
    expect(back.isolateSpawns).toBe(true)
  })

  it('is off for a canvas saved before worktrees existed', () => {
    // Turning it on creates directories on disk, and a file written by an
    // older build never consented to that.
    const data = { ...serializeCanvas(snapshot([])), isolateSpawns: undefined }
    expect(deserializeCanvas(data).isolateSpawns).toBe(false)
  })

  it('ignores a value that is not a boolean', () => {
    const data = { ...serializeCanvas(snapshot([])), isolateSpawns: 'yes' } as unknown as CanvasData
    expect(deserializeCanvas(data).isolateSpawns).toBe(false)
  })
})

describe('the check command', () => {
  it('round-trips', () => {
    const back = deserializeCanvas(
      JSON.parse(JSON.stringify(serializeCanvas({ ...snapshot([]), checkCommand: 'bun run test' }))),
    )
    expect(back.checkCommand).toBe('bun run test')
  })

  it('is empty for a canvas saved before checks existed, so nothing runs', () => {
    const data = { ...serializeCanvas(snapshot([])), checkCommand: undefined }
    expect(deserializeCanvas(data).checkCommand).toBe('')
  })

  it('refuses a value that is not a string', () => {
    // This one executes. A hand-edited file must not be able to make it
    // anything other than a command the user typed.
    const data = { ...serializeCanvas(snapshot([])), checkCommand: 42 } as unknown as CanvasData
    expect(deserializeCanvas(data).checkCommand).toBe('')
  })
})

describe('worktree nodes', () => {
  const folder = (id: string, data: Record<string, unknown>) =>
    ({ id, type: 'folder', position: { x: 0, y: 0 }, data: { folderId: id, ...data } }) as never

  it('keeps which branch a checkout is, so a reopened canvas still says who is who', () => {
    const node = folder('f1', {
      path: '/repo.worktrees/reviewer',
      worktree: { branch: 'wt/reviewer', repo: '/repo' },
    })
    const back = deserializeCanvas(
      JSON.parse(JSON.stringify(serializeCanvas(snapshot([node])))),
    )
    const saved = back.nodes.find((n) => n.id === 'f1')
    expect(saved?.type === 'folder' && saved.data.worktree).toEqual({
      branch: 'wt/reviewer',
      repo: '/repo',
    })
  })

  it('drops one that was never cut', () => {
    // A half-typed branch name is an intention, not a directory.
    const draft = folder('f2', { path: '', draft: true, worktree: { branch: '', repo: '/repo' } })
    const data = serializeCanvas(snapshot([draft]))
    expect(data.nodes.find((n) => n.id === 'f2')).toBeUndefined()
  })
})

describe('guards', () => {
  it('round-trips what this canvas holds back', () => {
    const back = deserializeCanvas(
      JSON.parse(JSON.stringify(serializeCanvas({ ...snapshot([]), guards: ['push', 'discard'] }))),
    )
    expect(back.guards).toEqual(['push', 'discard'])
  })

  it('holds nothing back for a canvas saved before guards existed', () => {
    const data = { ...serializeCanvas(snapshot([])), guards: undefined }
    expect(deserializeCanvas(data).guards).toEqual([])
  })

  it('drops anything that is not a rule name', () => {
    // A value this build cannot enforce would read as a guard that is on
    // while nothing checks it.
    const data = { ...serializeCanvas(snapshot([])), guards: ['push', 7, null] } as unknown as CanvasData
    expect(deserializeCanvas(data).guards).toEqual(['push'])
  })
})
