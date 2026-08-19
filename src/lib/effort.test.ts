import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  turns: [] as { prompt: string; effort: string | null }[],
  interrupts: [] as string[],
}))

vi.mock('./bridge', () => ({
  sendTurn: vi.fn(async (req: { prompt: string; effort: string | null }) => {
    calls.turns.push({ prompt: req.prompt, effort: req.effort })
  }),
  interruptSession: vi.fn(async (id: string) => {
    calls.interrupts.push(id)
  }),
  dirExists: vi.fn(async () => true),
  fileExists: vi.fn(async () => false),
  readFileHead: vi.fn(async () => ''),
}))

const { useStore } = await import('./store')

const session = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1',
    type: 'session' as const,
    position: { x: 0, y: 0 },
    data: {
      sessionId: 'sess_1',
      provider: 'claude',
      role: 'worker',
      name: 's1',
      cwd: '/tmp',
      state: 'streaming',
      permission: 'auto',
      effort: 'low',
      messages: [
        { id: 'm1', role: 'user', text: 'refactor the parser', tools: [] },
        { id: 'm2', role: 'assistant', text: 'half a rep', tools: [], pending: true },
      ],
      usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      skillIds: [],
      ...over,
    },
  }) as never

const folder = {
  id: 'f1',
  type: 'folder' as const,
  position: { x: 0, y: 0 },
  data: { folderId: 'f1', path: '/tmp' },
} as never

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  calls.turns.length = 0
  calls.interrupts.length = 0
  useStore.setState({
    nodes: [session(), folder],
    edges: [{ id: 'e1', source: 'f1', target: 's1', type: 'cwd' }],
    bus: [],
    delivered: {},
    queued: {},
    restarting: {},
    library: [],
  })
})

describe('setEffort', () => {
  it('stops and re-runs the turn it interrupts', async () => {
    useStore.getState().setEffort('s1', 'high')

    expect(useStore.getState().restarting.s1.text).toBe('refactor the parser')
    await settle()
    expect(calls.interrupts).toEqual(['sess_1'])

    // The provider exits because we stopped it.
    useStore.getState().applyEvent('sess_1', { kind: 'exited', code: 130 })
    await settle()
    await settle()

    expect(calls.turns).toHaveLength(1)
    expect(calls.turns[0].effort).toBe('high')
    expect(calls.turns[0].prompt).toContain('refactor the parser')
    expect(useStore.getState().restarting.s1).toBeUndefined()
  })

  it('leaves the transcript with one copy of the exchange', async () => {
    useStore.getState().setEffort('s1', 'high')
    useStore.getState().applyEvent('sess_1', { kind: 'exited', code: 130 })
    await settle()
    await settle()

    const node = useStore.getState().nodes.find((n) => n.id === 's1')!
    const data = node.data as { messages: { role: string; text: string }[] }
    // The abandoned half-reply is gone; the prompt appears once, re-sent.
    expect(data.messages.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(data.messages.some((m) => m.text === 'half a rep')).toBe(false)
  })

  it('does not publish the abandoned reply to the context bus', async () => {
    useStore.getState().setEffort('s1', 'high')
    useStore.getState().applyEvent('sess_1', { kind: 'exited', code: 130 })
    await settle()
    await settle()

    expect(useStore.getState().bus).toHaveLength(0)
  })

  it('applies to the next turn only when the session is idle', async () => {
    useStore.setState({ nodes: [session({ state: 'idle' }), folder] })
    useStore.getState().setEffort('s1', 'max')
    await settle()

    expect(calls.interrupts).toEqual([])
    expect(useStore.getState().restarting.s1).toBeUndefined()
    const node = useStore.getState().nodes.find((n) => n.id === 's1')!
    expect((node.data as { effort: string }).effort).toBe('max')
  })

  it('ignores a no-op change to the level already set', async () => {
    useStore.getState().setEffort('s1', 'low')
    await settle()
    expect(calls.interrupts).toEqual([])
  })
})
