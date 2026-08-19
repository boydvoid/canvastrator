import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge } from '@xyflow/react'

const calls = vi.hoisted(() => ({ turns: [] as { prompt: string; cwd: string }[] }))

vi.mock('./bridge', () => ({
  sendTurn: vi.fn(async (req: { prompt: string; cwd: string }) => {
    calls.turns.push({ prompt: req.prompt, cwd: req.cwd })
  }),
  interruptSession: vi.fn(async () => {}),
  dirExists: vi.fn(async () => true),
  fileExists: vi.fn(async () => false),
  readFileHead: vi.fn(async () => ''),
}))

const {
  canvasFoldersBlock,
  folderRootsFor,
  folderSetKey,
  reconcileFolderEdges,
  samePath,
  searchRootsFor,
  useStore,
} = await import('./store')
type GtNode = Awaited<ReturnType<typeof import('./store').useStore.getState>>['nodes'][number]

const folder = (id: string, path: string, missing = false) =>
  ({
    id,
    type: 'folder' as const,
    position: { x: 0, y: 0 },
    data: { folderId: id, path, missing },
  }) as GtNode

const session = (id: string) =>
  ({
    id,
    type: 'session' as const,
    position: { x: 0, y: 0 },
    data: {
      sessionId: `sess_${id}`,
      provider: 'claude',
      role: 'worker',
      name: id,
      cwd: '',
      state: 'idle',
      permission: 'auto',
      messages: [],
      usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      skillIds: [],
    },
  }) as GtNode

const edge = (source: string, target: string, type: string): Edge => ({
  id: `${type}_${source}->${target}`,
  source,
  target,
  type,
})

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  calls.turns.length = 0
  useStore.setState({
    nodes: [folder('f1', '/tmp/api'), folder('f2', '/tmp/docs'), session('s1')],
    edges: [],
    bus: [],
    delivered: {},
    queued: {},
    restarting: {},
    library: [],
    globalRules: '',
  })
})

const rootsOf = (id = 's1') => {
  const s = useStore.getState()
  return folderRootsFor(s.nodes, s.edges, id)
}
const typeOf = (source: string, target = 's1') =>
  useStore.getState().edges.find((e) => e.source === source && e.target === target)?.type

describe('folderRootsFor', () => {
  it('puts the working directory first, whatever order the edges are in', () => {
    const nodes = [folder('f1', '/tmp/api'), folder('f2', '/tmp/docs'), session('s1')]
    const edges = [edge('f2', 's1', 'attach'), edge('f1', 's1', 'cwd')]
    expect(folderRootsFor(nodes, edges, 's1')).toEqual([
      { nodeId: 'f1', path: '/tmp/api', primary: true, missing: false },
      { nodeId: 'f2', path: '/tmp/docs', primary: false, missing: false },
    ])
  })

  it('keeps extra roots in the order they were wired', () => {
    const nodes = [
      folder('f1', '/a'),
      folder('f2', '/b'),
      folder('f3', '/c'),
      session('s1'),
    ]
    const edges = [
      edge('f1', 's1', 'cwd'),
      edge('f2', 's1', 'attach'),
      edge('f3', 's1', 'attach'),
    ]
    expect(folderRootsFor(nodes, edges, 's1').map((r) => r.path)).toEqual(['/a', '/b', '/c'])
  })

  it('ignores attach edges that are not folders — an MCP server is one too', () => {
    const mcp = {
      id: 'm1',
      type: 'mcp' as const,
      position: { x: 0, y: 0 },
      data: { serverId: 'm1', name: 'flowiki', transport: 'stdio', source: 'user' },
    } as unknown as GtNode
    const nodes = [folder('f1', '/a'), mcp, session('s1')]
    const edges = [edge('f1', 's1', 'cwd'), edge('m1', 's1', 'attach')]
    expect(folderRootsFor(nodes, edges, 's1').map((r) => r.nodeId)).toEqual(['f1'])
  })

  it('reports a missing folder rather than dropping it, so it can be fixed', () => {
    const nodes = [folder('f1', '/gone', true), session('s1')]
    const edges = [edge('f1', 's1', 'cwd')]
    expect(folderRootsFor(nodes, edges, 's1')[0].missing).toBe(true)
    // The search picker can't use one, though.
    expect(searchRootsFor(nodes, edges, 's1')).toEqual([])
  })
})

describe('onConnect, wiring a folder in', () => {
  it('makes the first folder the working directory and the next an extra root', () => {
    useStore.getState().onConnect({ source: 'f1', target: 's1', sourceHandle: null, targetHandle: null })
    expect(typeOf('f1')).toBe('cwd')

    useStore.getState().onConnect({ source: 'f2', target: 's1', sourceHandle: null, targetHandle: null })
    expect(typeOf('f1')).toBe('cwd')
    expect(typeOf('f2')).toBe('attach')
  })

  it('never deletes the folder that was there first', () => {
    useStore.getState().onConnect({ source: 'f1', target: 's1', sourceHandle: null, targetHandle: null })
    useStore.getState().onConnect({ source: 'f2', target: 's1', sourceHandle: null, targetHandle: null })
    expect(rootsOf().map((r) => r.path)).toEqual(['/tmp/api', '/tmp/docs'])
  })

  it('refuses a second edge for a directory the session already reaches', () => {
    // Two folder nodes, one directory: the grant is the same either way.
    useStore.setState((s) => ({ nodes: [...s.nodes, folder('f3', '/tmp/api')] }))
    useStore.getState().onConnect({ source: 'f1', target: 's1', sourceHandle: null, targetHandle: null })
    useStore.getState().onConnect({ source: 'f3', target: 's1', sourceHandle: null, targetHandle: null })
    expect(rootsOf()).toHaveLength(1)
  })
})

describe('setPrimaryFolder', () => {
  beforeEach(() => {
    useStore.setState({ edges: [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'attach')] })
  })

  it('swaps the two edge types, so exactly one cwd survives', () => {
    useStore.getState().setPrimaryFolder('s1', 'f2')
    expect(typeOf('f2')).toBe('cwd')
    expect(typeOf('f1')).toBe('attach')
    expect(rootsOf().filter((r) => r.primary)).toHaveLength(1)
  })

  it('does nothing when the folder is already the working directory', () => {
    useStore.getState().setPrimaryFolder('s1', 'f1')
    expect(typeOf('f1')).toBe('cwd')
    expect(typeOf('f2')).toBe('attach')
  })
})

describe('detachFolder', () => {
  beforeEach(() => {
    useStore.setState({ edges: [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'attach')] })
  })

  it('removes the edge but leaves the node on the canvas', () => {
    useStore.getState().detachFolder('s1', 'f2')
    expect(rootsOf().map((r) => r.nodeId)).toEqual(['f1'])
    expect(useStore.getState().nodes.some((n) => n.id === 'f2')).toBe(true)
  })

  it('promotes the oldest survivor when the working directory goes, and says so', () => {
    useStore.getState().detachFolder('s1', 'f1')
    expect(typeOf('f2')).toBe('cwd')
    const node = useStore.getState().nodes.find((n) => n.id === 's1')!
    expect(node.type === 'session' && node.data.messages.at(-1)?.text).toContain('/tmp/docs')
  })

  it('leaves the session with no folder at all when the last one goes', () => {
    useStore.getState().detachFolder('s1', 'f2')
    useStore.getState().detachFolder('s1', 'f1')
    expect(rootsOf()).toEqual([])
  })
})

describe('attachFolder', () => {
  it('reuses a folder node already on the canvas for that path', () => {
    const id = useStore.getState().attachFolder('s1', '/tmp/docs')
    expect(id).toBe('f2')
    expect(typeOf('f2')).toBe('cwd')
  })

  it('will not wire the same directory in twice', () => {
    useStore.getState().attachFolder('s1', '/tmp/docs')
    expect(useStore.getState().attachFolder('s1', '/tmp/docs')).toBeNull()
    expect(rootsOf()).toHaveLength(1)
  })
})

describe('canvasFoldersBlock', () => {
  const roots = (n: number) =>
    [
      { nodeId: 'f1', path: '/tmp/api', primary: true, missing: false },
      { nodeId: 'f2', path: '/tmp/docs', primary: false, missing: false },
    ].slice(0, n)

  it('says nothing when there is only the working directory', () => {
    // One folder is the case the agent already knows about — it is sitting in it.
    expect(canvasFoldersBlock(roots(1))).toBe('')
  })

  it('names the working directory and lists the extras', () => {
    const block = canvasFoldersBlock(roots(2))
    expect(block).toContain('/tmp/api (working directory)')
    expect(block).toContain('/tmp/docs')
    expect(block.startsWith('<canvas-folders>')).toBe(true)
  })

  it('leaves out a folder that is not there', () => {
    expect(
      canvasFoldersBlock([...roots(2), { nodeId: 'f3', path: '/gone', primary: false, missing: true }]),
    ).not.toContain('/gone')
  })
})

describe('send, with more than one folder', () => {
  it('runs in the primary and tells the agent about the rest, once', async () => {
    useStore.setState({ edges: [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'attach')] })

    await useStore.getState().send('s1', 'go')
    expect(calls.turns[0].cwd).toBe('/tmp/api')
    expect(calls.turns[0].prompt).toContain('<canvas-folders>')
    expect(calls.turns[0].prompt).toContain('/tmp/docs')

    // Unchanged folders are already in the history; sending them again is waste.
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === 's1' && n.type === 'session'
          ? { ...n, data: { ...n.data, state: 'idle' as const, providerSessionId: 'p1' } }
          : n,
      ),
    }))
    await useStore.getState().send('s1', 'again')
    expect(calls.turns[1].prompt).not.toContain('<canvas-folders>')
    await settle()
  })

  it('refuses the turn when the working directory has gone missing', async () => {
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === 'f1' && n.type === 'folder' ? { ...n, data: { ...n.data, missing: true } } : n,
      ),
      edges: [edge('f1', 's1', 'cwd')],
    }))
    await useStore.getState().send('s1', 'go')
    expect(calls.turns).toHaveLength(0)
    const node = useStore.getState().nodes.find((n) => n.id === 's1')!
    expect(node.type === 'session' && node.data.messages.at(-1)?.text).toContain('/tmp/api')
  })
})

describe('reconcileFolderEdges, the one-cwd invariant', () => {
  const nodes = [folder('f1', '/tmp/api'), folder('f2', '/tmp/docs'), session('s1')]

  it('leaves a healthy graph alone, array identity and all', () => {
    const edges = [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'attach')]
    expect(reconcileFolderEdges(edges, nodes)).toBe(edges)
  })

  it('promotes the oldest survivor when there is no working directory', () => {
    const edges = [edge('f2', 's1', 'attach'), edge('f1', 's1', 'attach')]
    expect(reconcileFolderEdges(edges, nodes).map((e) => [e.source, e.type])).toEqual([
      ['f2', 'cwd'],
      ['f1', 'attach'],
    ])
  })

  it('demotes the extras when a saved canvas carries two working directories', () => {
    const edges = [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'cwd')]
    expect(reconcileFolderEdges(edges, nodes).map((e) => e.type)).toEqual(['cwd', 'attach'])
  })

  it('does not invent a folder edge out of an MCP attach', () => {
    const mcp = {
      id: 'm1',
      type: 'mcp' as const,
      position: { x: 0, y: 0 },
      data: { serverId: 'm1', name: 'flowiki', transport: 'stdio', source: 'user' },
    } as unknown as GtNode
    const edges = [edge('m1', 's1', 'attach')]
    expect(reconcileFolderEdges(edges, [...nodes, mcp])).toBe(edges)
  })
})

/**
 * The hole the invariant used to have: it was enforced where folders were
 * detached from the menu and nowhere else, so the two other ways an edge can
 * disappear left a session wired to folders it could not run in.
 */
describe('losing the working directory some other way', () => {
  beforeEach(() => {
    useStore.setState({ edges: [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'attach')] })
  })

  it('promotes an heir when the folder node itself is deleted', () => {
    useStore.getState().removeNode('f1')
    expect(typeOf('f2')).toBe('cwd')
    expect(rootsOf().filter((r) => r.primary)).toHaveLength(1)
    const node = useStore.getState().nodes.find((n) => n.id === 's1')!
    expect(node.type === 'session' && node.data.messages.at(-1)?.text).toContain('/tmp/docs')
  })

  it('promotes an heir when the cwd edge is selected and deleted', () => {
    useStore.getState().onEdgesChange([{ id: 'cwd_f1->s1', type: 'remove' }])
    expect(typeOf('f2')).toBe('cwd')
    expect(rootsOf().filter((r) => r.primary)).toHaveLength(1)
  })

  it('says nothing when the deletion took the last folder with it', () => {
    useStore.setState({ edges: [edge('f1', 's1', 'cwd')] })
    useStore.getState().removeNode('f1')
    expect(rootsOf()).toEqual([])
    const node = useStore.getState().nodes.find((n) => n.id === 's1')!
    expect(node.type === 'session' && node.data.messages).toEqual([])
  })

  it('leaves an unrelated deletion alone', () => {
    useStore.getState().removeNode('f2')
    expect(typeOf('f1')).toBe('cwd')
    const node = useStore.getState().nodes.find((n) => n.id === 's1')!
    expect(node.type === 'session' && node.data.messages).toEqual([])
  })
})

describe('a canvas loaded with the invariant already broken', () => {
  it('opens with an heir promoted rather than a session that cannot be sent to', async () => {
    const { deserializeCanvas } = await import('./persist')
    const restored = deserializeCanvas({
      nodes: [folder('f1', '/tmp/api'), session('s1')],
      edges: [edge('f1', 's1', 'attach')],
    } as never)
    expect(restored.edges.map((e) => e.type)).toEqual(['cwd'])
  })
})

describe('samePath', () => {
  it('ignores a trailing slash, which is the difference pickers actually produce', () => {
    expect(samePath('/tmp/api', '/tmp/api/')).toBe(true)
    expect(samePath('/tmp/api//', '/tmp/api')).toBe(true)
  })

  it('keeps the root itself a path', () => {
    expect(samePath('/', '/')).toBe(true)
  })

  it('does not claim two different directories are one', () => {
    expect(samePath('/tmp/api', '/tmp/apis')).toBe(false)
  })

  it('will not wire the same directory in twice under a trailing slash', () => {
    useStore.getState().attachFolder('s1', '/tmp/docs')
    expect(useStore.getState().attachFolder('s1', '/tmp/docs/')).toBeNull()
    expect(rootsOf()).toHaveLength(1)
  })
})

describe('folderSetKey', () => {
  const r = (path: string, primary = false) => ({ nodeId: path, path, primary, missing: false })

  it('does not care what order the extras arrive in', () => {
    expect(folderSetKey([r('/a', true), r('/b'), r('/c')])).toBe(
      folderSetKey([r('/a', true), r('/c'), r('/b')]),
    )
  })

  it('still changes when the set does', () => {
    expect(folderSetKey([r('/a', true), r('/b')])).not.toBe(folderSetKey([r('/a', true)]))
    // Which folder is the working directory is part of the set.
    expect(folderSetKey([r('/a', true), r('/b')])).not.toBe(folderSetKey([r('/a'), r('/b', true)]))
  })

  it('leaves out a folder that is not there, the same way the block does', () => {
    expect(folderSetKey([r('/a', true), { ...r('/gone'), missing: true }])).toBe(
      folderSetKey([r('/a', true)]),
    )
  })
})

/**
 * The claim in `sentFolders`: the block goes whenever the set changes, and
 * never twice unchanged. Both halves had a hole — reordering counted as a
 * change, and shrinking back to one folder counted as no change at all.
 */
describe('telling the agent what changed', () => {
  const idle = () =>
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === 's1' && n.type === 'session'
          ? { ...n, data: { ...n.data, state: 'idle' as const, providerSessionId: 'p1' } }
          : n,
      ),
    }))

  it('does not resend the same set just because the extras were reordered', async () => {
    useStore.setState((s) => ({
      nodes: [...s.nodes, folder('f3', '/tmp/web')],
      edges: [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'attach'), edge('f3', 's1', 'attach')],
    }))
    await useStore.getState().send('s1', 'go')
    expect(calls.turns[0].prompt).toContain('<canvas-folders>')
    idle()

    // Detach and reattach with no turn in between: same three folders, and
    // the extras now come back in the other order.
    useStore.getState().detachFolder('s1', 'f2')
    useStore.getState().attachFolder('s1', '/tmp/docs')
    expect(rootsOf().map((r) => r.path)).toEqual(['/tmp/api', '/tmp/web', '/tmp/docs'])

    await useStore.getState().send('s1', 'again')
    expect(calls.turns[1].prompt).not.toContain('<canvas-folders>')
    await settle()
  })

  it('retracts the extra roots when the set shrinks back to one folder', async () => {
    useStore.setState({ edges: [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'attach')] })
    await useStore.getState().send('s1', 'go')
    expect(calls.turns[0].prompt).toContain('/tmp/docs')
    idle()

    useStore.getState().detachFolder('s1', 'f2')
    await useStore.getState().send('s1', 'again')
    // Silence here would leave the agent reading from a path it was handed
    // earlier in the same transcript.
    expect(calls.turns[1].prompt).toContain('<canvas-folders>')
    expect(calls.turns[1].prompt).toContain('/tmp/api')
    expect(calls.turns[1].prompt).toContain('no longer')
    await settle()
  })

  it('says nothing on the first turn of a session that only ever had one folder', async () => {
    useStore.setState({ edges: [edge('f1', 's1', 'cwd')] })
    await useStore.getState().send('s1', 'go')
    expect(calls.turns[0].prompt).not.toContain('<canvas-folders>')
    await settle()
  })
})

/**
 * A worker spawned to work across two repos needs both of them. This used to
 * inherit the parent's `cwd` edge alone — `.find` rather than `.filter` — and
 * it is the edit in this change most likely to be quietly undone.
 */
describe('a child of a multi-folder parent', () => {
  const persona = {
    id: 'p1',
    name: 'implementer',
    description: 'implements',
    provider: 'claude' as const,
    permission: 'auto' as const,
    instructions: 'Do the thing.',
  }

  // `spawnChild` waits on the child's first turn, which a mocked provider
  // never ends — so the child is idled by hand once its wiring is in place.
  const spawnFrom = async (parentId: string) => {
    const before = new Set(useStore.getState().nodes.map((n) => n.id))
    useStore.setState({
      library: [persona],
      plan: {
        fromNodeId: parentId,
        goal: 'ship it',
        steps: [{ id: 'step1', persona: 'implementer', task: 'go', state: 'pending' }],
        proposedAt: 0,
      },
    })
    const running = useStore.getState().approvePlanStep('step1')
    await settle()
    const childId = useStore
      .getState()
      .nodes.find((n) => n.type === 'session' && !before.has(n.id))!.id
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.type === 'session' ? { ...n, data: { ...n.data, state: 'idle' as const } } : n,
      ),
    }))
    await running
    expect(useStore.getState().plan?.steps[0].error).toBeUndefined()
    return childId
  }

  it('inherits every folder, with the parent’s primacy preserved', async () => {
    useStore.setState((s) => ({
      nodes: [...s.nodes, folder('f3', '/tmp/web')],
      edges: [edge('f1', 's1', 'attach'), edge('f2', 's1', 'cwd'), edge('f3', 's1', 'attach')],
    }))

    const childId = await spawnFrom('s1')
    expect(rootsOf(childId).map((r) => r.path)).toEqual(['/tmp/docs', '/tmp/api', '/tmp/web'])
    expect(rootsOf(childId).filter((r) => r.primary)).toHaveLength(1)
    // And its own first turn ran in the folder its parent called primary.
    expect(calls.turns[0].cwd).toBe('/tmp/docs')
    await settle()
  })

  it('does not drag the parent’s MCP servers along as folders', async () => {
    const mcp = {
      id: 'm1',
      type: 'mcp' as const,
      position: { x: 0, y: 0 },
      data: { serverId: 'm1', name: 'flowiki', transport: 'stdio', source: 'user' },
    } as unknown as GtNode
    useStore.setState((s) => ({
      nodes: [...s.nodes, mcp],
      edges: [edge('f1', 's1', 'cwd'), edge('f2', 's1', 'attach'), edge('m1', 's1', 'attach')],
    }))

    const childId = await spawnFrom('s1')
    const inherited = useStore
      .getState()
      .edges.filter((e) => e.target === childId && (e.type === 'cwd' || e.type === 'attach'))
    expect(inherited.map((e) => e.source).sort()).toEqual(['f1', 'f2'])
    expect(inherited.filter((e) => e.type === 'cwd')).toHaveLength(1)
    await settle()
  })
})
