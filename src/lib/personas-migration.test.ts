import { describe, expect, it } from 'vitest'
import { deserializeCanvas, strandedPersonas, type CanvasData } from './persist'

const personalityNode = (name: string) => ({
  id: `p_${name}`,
  type: 'personality',
  position: { x: 0, y: 0 },
  data: {
    personalityId: `pers_${name}`,
    name,
    description: 'when to use it',
    provider: 'claude',
    permission: 'auto',
    effort: 'medium',
    instructions: 'You do the thing.',
  },
})

const sessionNode = {
  id: 's1',
  type: 'session',
  position: { x: 0, y: 0 },
  data: {
    sessionId: 'sess_1',
    provider: 'claude',
    role: 'worker',
    name: 's1',
    cwd: '/tmp',
    state: 'idle',
    permission: 'auto',
    messages: [],
    usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    skillIds: [],
  },
}

const canvas = (): CanvasData =>
  ({
    version: 1,
    nodes: [sessionNode, personalityNode('reviewer'), personalityNode('implementer')],
    edges: [
      { id: 'a1', source: 'p_reviewer', target: 's1', type: 'attach' },
      { id: 'a2', source: 'p_implementer', target: 's1', type: 'attach' },
    ],
  }) as never

const summaryNode = {
  id: 'sum1',
  type: 'summary',
  position: { x: 0, y: 0 },
  data: { summaryId: 's', sessionNodeId: 's1', headline: 'did a thing', tools: [], ts: 1 },
}

describe('loading a canvas saved with summary nodes', () => {
  it('drops them, and the edges that tied them to their agent', () => {
    const data = {
      nodes: [sessionNode, summaryNode],
      edges: [{ id: 'e', source: 's1', target: 'sum1', type: 'summary' }],
    } as never
    const out = deserializeCanvas(data)
    expect(out.nodes.map((n) => n.id)).toEqual(['s1'])
    expect(out.edges).toEqual([])
  })

  it('starts the feed empty rather than inventing entries from them', () => {
    const out = deserializeCanvas({ nodes: [sessionNode, summaryNode] } as never)
    expect(out.notifications).toEqual([])
  })
})

describe('loading a canvas saved with personality nodes', () => {
  it('drops the nodes', () => {
    const out = deserializeCanvas(canvas())
    expect(out.nodes.map((n) => n.id)).toEqual(['s1'])
  })

  it('drops the edges that wired them in, leaving nothing dangling', () => {
    const out = deserializeCanvas(canvas())
    const ids = new Set(out.nodes.map((n) => n.id))
    for (const e of out.edges) {
      expect(ids.has(e.source) && ids.has(e.target)).toBe(true)
    }
  })

  /** Deleting a node the user defined by hand would be losing their work. */
  it('hands back the personas so they can be rescued into the library', () => {
    const rescued = strandedPersonas(canvas())
    expect(rescued.map((p) => p.name)).toEqual(['reviewer', 'implementer'])
    expect(rescued[0].instructions).toBe('You do the thing.')
  })

  it('ignores nodes with no usable name', () => {
    const data = {
      nodes: [{ id: 'x', type: 'personality', data: { name: '   ' } }, { id: 'y', type: 'personality' }],
    } as never
    expect(strandedPersonas(data)).toEqual([])
  })

  it('finds nothing on a canvas that never had any', () => {
    expect(strandedPersonas({ version: 1, nodes: [sessionNode], edges: [] } as never)).toEqual([])
    expect(strandedPersonas(null)).toEqual([])
  })
})
