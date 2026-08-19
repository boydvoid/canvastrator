import { beforeEach, describe, expect, it, vi } from 'vitest'

const saved = vi.hoisted(() => ({ docs: [] as { id: string; name: string; data: { nodes: unknown[] } }[] }))

vi.mock('./bridge', () => ({
  saveCanvasDoc: vi.fn(async (doc) => {
    saved.docs.push(doc)
  }),
  loadCanvasDoc: vi.fn(),
  listCanvases: vi.fn(async () => []),
  deleteCanvasDoc: vi.fn(),
}))

const { saveCanvas, watchCanvas, renameCanvas, deleteCanvases } = await import('./canvas')
const { deleteCanvasDoc } = await import('./bridge')
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
