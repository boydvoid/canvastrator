import { beforeEach, describe, expect, it, vi } from 'vitest'

const saved = vi.hoisted(() => ({
  docs: [] as { id: string; name: string; data: { nodes: unknown[] } }[],
  /** What happened, in the order it happened — a delete undone is an ordering bug. */
  order: [] as string[],
  writeDelayMs: 0,
}))

vi.mock('./bridge', () => ({
  saveCanvasDoc: vi.fn(async (doc) => {
    // A write takes time, and what happens in that window is the whole point
    // of the deletion tests below.
    if (saved.writeDelayMs) await new Promise((r) => setTimeout(r, saved.writeDelayMs))
    saved.docs.push(doc)
    saved.order.push(`save:${doc.id}`)
  }),
  loadCanvasDoc: vi.fn(),
  listCanvases: vi.fn(async () => []),
  deleteCanvasDoc: vi.fn(async (id: string) => {
    saved.order.push(`delete:${id}`)
    saved.docs = saved.docs.filter((d) => d.id !== id)
  }),
}))

const {
  saveCanvas,
  watchCanvas,
  renameCanvas,
  deleteCanvas,
  deleteCanvases,
  beginLaunchRestore,
  restoreLastCanvas,
  newCanvas,
} = await import('./canvas')
const { deleteCanvasDoc, loadCanvasDoc } = await import('./bridge')
const { useStore } = await import('./store')

const node = (id: string) =>
  ({
    id,
    type: 'folder' as const,
    position: { x: 0, y: 0 },
    data: { folderId: id, path: '/tmp' },
  }) as never

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  saved.docs.length = 0
  saved.order.length = 0
  saved.writeDelayMs = 0
  useStore.setState({
    nodes: [],
    edges: [],
    bus: [],
    delivered: {},
    canvasId: null,
    canvasName: 'untitled',
    canvasSavedAt: null,
    canvasDirty: false,
    canvasError: null,
  })
})

describe('autosave', () => {
  it('writes nothing for an empty canvas', async () => {
    const stop = watchCanvas()
    useStore.setState({ bus: [] as never })
    await vi.waitFor(() => expect(useStore.getState().canvasDirty).toBe(true))
    await new Promise((r) => setTimeout(r, 1400))
    expect(saved.docs).toHaveLength(0)
    stop()
  })

  it('mints a canvas on the first node, with no manual save', async () => {
    const stop = watchCanvas()
    useStore.setState({ nodes: [node('a')] as never })
    await vi.waitFor(() => expect(saved.docs).toHaveLength(1), { timeout: 3000 })
    expect(useStore.getState().canvasId).toBeTruthy()
    expect(saved.docs[0].name).toBe('untitled')
    stop()
  })

  /**
   * The bug this pins: "Clear canvas" used to empty the graph while keeping
   * canvasId, so autosave immediately overwrote the only copy on disk.
   */
  it('refuses to overwrite a saved canvas with an empty one', async () => {
    useStore.setState({ nodes: [node('a')] as never })
    await saveCanvas('keeper')
    expect(saved.docs).toHaveLength(1)

    const stop = watchCanvas()
    useStore.setState({ nodes: [] as never })
    await new Promise((r) => setTimeout(r, 1500))

    expect(saved.docs).toHaveLength(1)
    expect(saved.docs[0].data.nodes).toHaveLength(1)
    stop()
  })
})

describe('renameCanvas', () => {
  it('writes the new name straight away for a saved canvas', async () => {
    useStore.setState({ nodes: [node('a')] as never })
    await saveCanvas('before')
    await renameCanvas('after')
    await settle()
    expect(useStore.getState().canvasName).toBe('after')
    expect(saved.docs.at(-1)?.name).toBe('after')
  })

  it('carries the name to the first save of an unsaved canvas', async () => {
    await renameCanvas('planned')
    expect(useStore.getState().canvasName).toBe('planned')
    expect(saved.docs).toHaveLength(0)
  })

  it('ignores an empty name', async () => {
    useStore.setState({ canvasName: 'keep' })
    await renameCanvas('   ')
    expect(useStore.getState().canvasName).toBe('keep')
  })
})

describe('deleting several canvases', () => {
  it('carries on past a file it cannot delete, and reports the shortfall', async () => {
    vi.mocked(deleteCanvasDoc).mockImplementation(async (id: string) => {
      if (id === 'b') throw new Error('locked')
    })

    const gone = await deleteCanvases(['a', 'b', 'c'])

    expect(gone).toEqual(['a', 'c'])
    expect(useStore.getState().canvasError).toBe('could not delete 1 of 3')
  })

  /**
   * Changed deliberately. This used to keep the graph on screen so the work
   * wasn't lost with the file — but a graph with content and no file is what
   * autosave rescues, so it wrote the canvas back a second later and the
   * deletion undid itself. Clearing to a blank canvas is the only version that
   * actually sticks.
   */
  it('clears to a blank canvas when its own file goes', async () => {
    vi.mocked(deleteCanvasDoc).mockImplementation(async () => {})
    useStore.setState({ canvasId: 'here', nodes: [node('a')] as never, canvasSavedAt: 1 })

    await deleteCanvases(['here'])

    const s = useStore.getState()
    expect(s.nodes).toHaveLength(0)
    expect(s.canvasId).toBeNull()
    expect(s.canvasName).toBe('untitled')
    expect(s.canvasDirty).toBe(false)
    expect(s.canvasError).toBeNull()
  })
})

describe('deleting canvases', () => {
  const node = (id: string) =>
    ({ id, type: 'folder' as const, position: { x: 0, y: 0 }, data: { folderId: id, path: '/tmp' } }) as never

  /**
   * The bug: deleting the open canvas dropped its id but kept the graph, so
   * autosave saw content with no file and wrote it straight back. The row
   * reappeared a second later and the delete looked broken.
   */
  it('does not let autosave resurrect the canvas it just deleted', async () => {
    const { deleteCanvas, watchCanvas } = await import('./canvas')
    useStore.setState({ nodes: [node('a')] as never, canvasId: 'canvas_x', canvasName: 'doomed' })
    saved.docs.length = 0

    const stop = watchCanvas()
    await deleteCanvas('canvas_x')
    await new Promise((r) => setTimeout(r, 1600))
    stop()

    expect(saved.docs, 'a deleted canvas must not be written back').toHaveLength(0)
    expect(useStore.getState().canvasId).toBeNull()
  })

  it('leaves a blank untitled canvas behind', async () => {
    const { deleteCanvas } = await import('./canvas')
    useStore.setState({ nodes: [node('a')] as never, canvasId: 'canvas_y', canvasName: 'gone' })
    await deleteCanvas('canvas_y')

    const s = useStore.getState()
    expect(s.canvasName).toBe('untitled')
    expect(s.nodes).toEqual([])
    expect(s.canvasId).toBeNull()
    expect(s.canvasDirty).toBe(false)
  })

  /** Deleting some other canvas must not disturb what you're working on. */
  it('leaves the open canvas alone when a different one is deleted', async () => {
    const { deleteCanvas } = await import('./canvas')
    useStore.setState({ nodes: [node('a')] as never, canvasId: 'canvas_open', canvasName: 'mine' })
    await deleteCanvas('canvas_other')

    const s = useStore.getState()
    expect(s.canvasId).toBe('canvas_open')
    expect(s.canvasName).toBe('mine')
    expect(s.nodes).toHaveLength(1)
  })
})

/**
 * Two ways the app used to grow an "untitled" canvas on every launch. Both end
 * the same way — a file nobody asked for, next to the one they were working in
 * — and both are about *minting*, never about losing an edit.
 */
describe('reopening without duplicating', () => {
  // The real thing is the webview's; the code already treats it as optional,
  // so this only has to be enough to remember one id between calls.
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })

  beforeEach(() => {
    localStorage.clear()
    vi.mocked(loadCanvasDoc).mockReset()
    newCanvas()
  })

  it('mints nothing while the launch restore is still in flight', async () => {
    beginLaunchRestore()
    const stop = watchCanvas()
    // A node landing in the window before the restore resolves: an agent
    // event, or a fast click. This used to become a whole canvas file, which
    // the real one then loaded over and orphaned.
    useStore.setState({ nodes: [node('a')] as never })
    await new Promise((r) => setTimeout(r, 1500))
    expect(saved.docs).toHaveLength(0)
    stop()
  })

  it('mints again once the restore has settled', async () => {
    beginLaunchRestore()
    const stop = watchCanvas()
    localStorage.setItem('canvastrator.lastCanvas', '')
    await restoreLastCanvas()
    useStore.setState({ nodes: [node('a')] as never })
    await vi.waitFor(() => expect(saved.docs).toHaveLength(1), { timeout: 3000 })
    stop()
  })

  it('keeps pointing at a canvas that exists but would not open', async () => {
    localStorage.setItem('canvastrator.lastCanvas', 'canvas_broken')
    vi.mocked(loadCanvasDoc).mockRejectedValue('canvas_broken is not a canvas file: EOF')

    beginLaunchRestore()
    const stop = watchCanvas()
    expect(await restoreLastCanvas()).toBe(false)

    // The pointer survives, so the next launch tries the same file again
    // rather than having quietly moved on to a new one.
    expect(localStorage.getItem('canvastrator.lastCanvas')).toBe('canvas_broken')
    // And it says so, instead of looking like a fresh start.
    expect(useStore.getState().canvasError).toContain("Couldn't open your last canvas")

    // Work done in this state does not become a second file.
    useStore.setState({ nodes: [node('a')] as never })
    await new Promise((r) => setTimeout(r, 1500))
    expect(saved.docs).toHaveLength(0)
    stop()
  })

  it('forgets a canvas that is genuinely gone, and says nothing about it', async () => {
    localStorage.setItem('canvastrator.lastCanvas', 'canvas_deleted')
    vi.mocked(loadCanvasDoc).mockRejectedValue('canvas-missing')

    beginLaunchRestore()
    const stop = watchCanvas()
    expect(await restoreLastCanvas()).toBe(false)

    expect(localStorage.getItem('canvastrator.lastCanvas')).toBeNull()
    expect(useStore.getState().canvasError).toBeNull()

    // A first run in every respect, so a new canvas is exactly right here.
    useStore.setState({ nodes: [node('a')] as never })
    await vi.waitFor(() => expect(saved.docs).toHaveLength(1), { timeout: 3000 })
    stop()
  })

  it('lets an explicit new canvas break out of the detached state', async () => {
    localStorage.setItem('canvastrator.lastCanvas', 'canvas_broken')
    vi.mocked(loadCanvasDoc).mockRejectedValue('unreadable')
    beginLaunchRestore()
    await restoreLastCanvas()

    const stop = watchCanvas()
    newCanvas()
    // `newCanvas` suppresses the watcher for its own update, and that
    // suppression lifts on a microtask — so a node added in the very same tick
    // would be ignored by the watcher rather than by the gate under test.
    await settle()
    useStore.setState({ nodes: [node('a')] as never })
    await vi.waitFor(() => expect(saved.docs).toHaveLength(1), { timeout: 3000 })
    stop()
  })
})

/**
 * A deleted canvas that comes back on the next launch.
 *
 * Autosave and delete race twice: a debounced save can be a second from
 * firing, and one can already be in flight holding a snapshot of the canvas
 * about to go. Either writes the file back out — and the finishing save also
 * records the id as "the canvas to reopen", so the app returns to the canvas
 * the user deleted even when the bytes did stay gone.
 */
describe('deleting a canvas makes it stay deleted', () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })

  beforeEach(() => {
    localStorage.clear()
    // Earlier tests replace this permanently to simulate failures, so the
    // recording implementation has to be put back before these run.
    vi.mocked(deleteCanvasDoc).mockImplementation(async (id: string) => {
      saved.order.push(`delete:${id}`)
      saved.docs = saved.docs.filter((d) => d.id !== id)
    })
    newCanvas()
  })

  it('does not let a debounced autosave write it back', async () => {
    const stop = watchCanvas()
    useStore.setState({ nodes: [node('a')] as never })
    await vi.waitFor(() => expect(saved.docs).toHaveLength(1), { timeout: 3000 })
    const id = useStore.getState().canvasId!

    // An edit, then a delete before the 1.2s debounce comes round.
    useStore.setState({ nodes: [node('a'), node('b')] as never })
    await deleteCanvas(id)
    await new Promise((r) => setTimeout(r, 1600))

    expect(saved.docs.find((d) => d.id === id)).toBeUndefined()
    expect(saved.order.filter((o) => o === `save:${id}`)).toHaveLength(1)
    stop()
  })

  it('waits for a write already in flight rather than deleting underneath it', async () => {
    const stop = watchCanvas()
    useStore.setState({ nodes: [node('a')] as never })
    await vi.waitFor(() => expect(saved.docs).toHaveLength(1), { timeout: 3000 })
    const id = saved.docs[0].id

    // A slow write in the air, and the delete asked for while it is away. The
    // delete used to land first and the write then put the file back.
    saved.writeDelayMs = 60
    const writing = saveCanvas()
    await deleteCanvas(id)
    await writing

    // The delete is last, so the file is gone at the end rather than written
    // back out a moment after it was removed.
    expect(saved.order.at(-1)).toMatch(/^delete:/)
    expect(saved.docs).toHaveLength(0)
    stop()
  })

  it('never points the next launch back at a canvas that was deleted', async () => {
    const stop = watchCanvas()
    saved.writeDelayMs = 60
    useStore.setState({ nodes: [node('a')] as never })
    await vi.waitFor(() => expect(saved.docs).toHaveLength(1), { timeout: 3000 })
    const id = saved.docs[0].id
    expect(localStorage.getItem('canvastrator.lastCanvas')).toBe(id)

    // A save in flight, and the canvas deleted while it is away. Its tail used
    // to run regardless and write the id straight back into the pointer.
    useStore.setState({ nodes: [node('a'), node('b')] as never })
    const writing = saveCanvas()
    await deleteCanvas(id)
    await writing

    expect(localStorage.getItem('canvastrator.lastCanvas')).toBeNull()
    expect(useStore.getState().canvasId).toBeNull()
    stop()
  })
})
