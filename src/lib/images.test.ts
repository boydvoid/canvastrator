import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge } from '@xyflow/react'

const calls = vi.hoisted(() => ({
  turns: [] as { prompt: string; images: string[] }[],
  cleared: [] as string[],
  /** Path → what `file_stamp` reports. Absent means the file isn't there. */
  stamps: new Map<string, { bytes: number; mtimeMs: number }>(),
  /** Path → text. Anything not listed reads back as an unreadable binary. */
  texts: new Map<string, string>(),
}))

vi.mock('./bridge', () => ({
  sendTurn: vi.fn(async (req: { prompt: string; images: string[] }) => {
    calls.turns.push({ prompt: req.prompt, images: req.images })
  }),
  interruptSession: vi.fn(async () => {}),
  dirExists: vi.fn(async () => true),
  fileExists: vi.fn(async () => false),
  clearSessionImages: vi.fn(async (id: string) => {
    calls.cleared.push(id)
  }),
  fileStamp: vi.fn(async (path: string) => calls.stamps.get(path) ?? null),
  readFileHead: vi.fn(async (path: string) => {
    const text = calls.texts.get(path)
    return text === undefined
      ? { text: '', bytes: 4096, truncated: false, binary: true }
      : { text, bytes: text.length, truncated: false, binary: false }
  }),
}))

const { useStore } = await import('./store')
const { clearFileCache } = await import('./filecache')
type GtNode = Awaited<ReturnType<typeof import('./store').useStore.getState>>['nodes'][number]

const folder = (id: string, path: string) =>
  ({
    id,
    type: 'folder' as const,
    position: { x: 0, y: 0 },
    data: { folderId: id, path, missing: false },
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

const file = (id: string, path: string) =>
  ({
    id,
    type: 'file' as const,
    position: { x: 0, y: 0 },
    data: { fileId: id, path, origin: 'user' as const },
  }) as GtNode

const edge = (source: string, target: string, type: string): Edge => ({
  id: `${type}_${source}->${target}`,
  source,
  target,
  type,
})

/**
 * Put a session back to idle. A turn leaves it `thinking`, and a second `send`
 * at a busy session queues rather than going out.
 */
const idle = (id: string) =>
  useStore.setState((s) => ({
    nodes: s.nodes.map((n) =>
      n.id === id && n.type === 'session' ? { ...n, data: { ...n.data, state: 'idle' } } : n,
    ) as GtNode[],
  }))

beforeEach(() => {
  calls.turns.length = 0
  calls.cleared.length = 0
  calls.stamps.clear()
  calls.texts.clear()
  clearFileCache()
  useStore.setState({
    nodes: [folder('f1', '/tmp/api'), session('s1')],
    edges: [edge('f1', 's1', 'cwd')],
    bus: [],
    delivered: {},
    queued: {},
    restarting: {},
    library: [],
    globalRules: '',
  })
})

describe('images on a turn', () => {
  it('passes pasted paths to the backend and records them on the message', async () => {
    const pasted = ['/tmp/gridterm/sess_s1/a.png', '/tmp/gridterm/sess_s1/b.png']
    await useStore.getState().send('s1', 'what is wrong here', pasted)

    expect(calls.turns[0].images).toEqual(pasted)
    const node = useStore.getState().nodes.find((n) => n.id === 's1')
    const sent = node?.type === 'session' ? node.data.messages[0] : undefined
    expect(sent?.images).toEqual(pasted)
  })

  it('leaves the field off a message with no images, so old canvases stay comparable', async () => {
    await useStore.getState().send('s1', 'just words')

    expect(calls.turns[0].images).toEqual([])
    const node = useStore.getState().nodes.find((n) => n.id === 's1')
    const sent = node?.type === 'session' ? node.data.messages[0] : undefined
    expect(sent && 'images' in sent).toBe(false)
  })

  /**
   * The bug: image file nodes were dropped by the `peek.binary` guard, before
   * a digest was recorded — so wiring a screenshot into an agent did nothing,
   * silently, on every turn.
   */
  it('sends an image file node as an image rather than dropping it', async () => {
    useStore.setState((s) => ({
      nodes: [...s.nodes, file('i1', '/tmp/api/shot.png')],
      edges: [...s.edges, edge('i1', 's1', 'file')],
    }))
    calls.stamps.set('/tmp/api/shot.png', { bytes: 1024, mtimeMs: 1_700_000_000_000 })

    await useStore.getState().send('s1', 'look')
    expect(calls.turns[0].images).toEqual(['/tmp/api/shot.png'])
    // Not injected as text, and not announced as unreadable either.
    expect(calls.turns[0].prompt).not.toContain('canvastrator-file')
  })

  it('says so when a binary that is not an image is wired in', async () => {
    useStore.setState((s) => ({
      nodes: [...s.nodes, file('b1', '/tmp/api/app.wasm')],
      edges: [...s.edges, edge('b1', 's1', 'file')],
    }))

    await useStore.getState().send('s1', 'look')
    expect(calls.turns[0].images).toEqual([])
    expect(calls.turns[0].prompt).toContain(
      '<canvastrator-file path="/tmp/api/app.wasm" binary="true" bytes="4096" />',
    )
  })

  it('drops a session’s images when its node is deleted', () => {
    useStore.getState().removeNode('s1')
    expect(calls.cleared).toEqual(['sess_s1'])
  })

  it('leaves a folder node alone — it has no session images to drop', () => {
    useStore.getState().removeNode('f1')
    expect(calls.cleared).toEqual([])
  })

  /**
   * `fileKind` calls an SVG an image because a browser draws one. A CLI does
   * not: it was arriving as `-i` on a file none of them rasterise, having
   * previously arrived as markup the agent could read and edit.
   */
  it('keeps an SVG on the text path and sends its markup', async () => {
    useStore.setState((s) => ({
      nodes: [...s.nodes, file('v1', '/tmp/api/logo.svg')],
      edges: [...s.edges, edge('v1', 's1', 'file')],
    }))
    calls.texts.set('/tmp/api/logo.svg', '<svg viewBox="0 0 8 8" />')

    await useStore.getState().send('s1', 'look')
    expect(calls.turns[0].images).toEqual([])
    expect(calls.turns[0].prompt).toContain('<svg viewBox="0 0 8 8" />')
  })

  /** A multi-resolution container none of the three decode — not an image. */
  it('keeps an .ico off the image path', async () => {
    useStore.setState((s) => ({
      nodes: [...s.nodes, file('c1', '/tmp/api/favicon.ico')],
      edges: [...s.edges, edge('c1', 's1', 'file')],
    }))

    await useStore.getState().send('s1', 'look')
    expect(calls.turns[0].images).toEqual([])
    expect(calls.turns[0].prompt).toContain('binary="true"')
  })

  /**
   * The digest used to be of the path, which never changes — so an image
   * edited on disk was remembered as already sent and never went again.
   */
  it('re-sends an image file node once the file on disk changes', async () => {
    useStore.setState((s) => ({
      nodes: [...s.nodes, file('i1', '/tmp/api/shot.png')],
      edges: [...s.edges, edge('i1', 's1', 'file')],
    }))
    calls.stamps.set('/tmp/api/shot.png', { bytes: 1024, mtimeMs: 1_700_000_000_000 })

    await useStore.getState().send('s1', 'first')
    expect(calls.turns[0].images).toEqual(['/tmp/api/shot.png'])

    // Unchanged: already in the agent's history, and costs nothing to omit.
    idle('s1')
    await useStore.getState().send('s1', 'again')
    expect(calls.turns[1].images).toEqual([])

    // Re-saved over the same path: a different image under an identical name.
    calls.stamps.set('/tmp/api/shot.png', { bytes: 2048, mtimeMs: 1_700_000_009_000 })
    idle('s1')
    await useStore.getState().send('s1', 'and now')
    expect(calls.turns[2].images).toEqual(['/tmp/api/shot.png'])
  })

  /**
   * The text path catches an unreadable file and carries on. The image path
   * had no existence check at all, so one deleted screenshot took the whole
   * turn down with it.
   */
  it('carries on when an image file node points at nothing', async () => {
    useStore.setState((s) => ({
      nodes: [...s.nodes, file('i1', '/tmp/api/gone.png')],
      edges: [...s.edges, edge('i1', 's1', 'file')],
    }))

    await useStore.getState().send('s1', 'look')
    expect(calls.turns).toHaveLength(1)
    expect(calls.turns[0].images).toEqual([])
    expect(calls.turns[0].prompt).toContain('path="/tmp/api/gone.png" error="unreadable"')

    // No digest recorded, so it goes out the moment it comes back.
    calls.stamps.set('/tmp/api/gone.png', { bytes: 64, mtimeMs: 1_700_000_000_000 })
    idle('s1')
    await useStore.getState().send('s1', 'again')
    expect(calls.turns[1].images).toEqual(['/tmp/api/gone.png'])
  })
})
