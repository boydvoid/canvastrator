import { deleteCanvasDoc, listCanvases, loadCanvasDoc, saveCanvasDoc } from './bridge'
import { CANVAS_VERSION, deserializeCanvas, serializeCanvas, type CanvasMeta } from './persist'
import { justWentQuiet, playDone } from './chime'
import { useStore } from './store'

/** Which canvas to reopen on launch. Per-machine, so not part of the file. */
const LAST_KEY = 'canvastrator.lastCanvas'

const rid = () => Math.random().toString(36).slice(2, 10)

/** Long enough that a streaming turn doesn't write a file per token. */
const AUTOSAVE_MS = 1200

/**
 * Set while we're the ones replacing the graph. Loading a canvas changes every
 * node, which would otherwise look like an edit and mark the canvas dirty.
 */
let loading = false

let timer: ReturnType<typeof setTimeout> | null = null

/** Canvas id we've already warned about, so the log isn't spammed per edit. */
let emptyGuardTripped: string | null = null

function suppress<T>(fn: () => T): T {
  loading = true
  try {
    return fn()
  } finally {
    // Cleared after the subscribers for this update have run.
    queueMicrotask(() => {
      loading = false
    })
  }
}

function rememberLast(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id)
    else localStorage.removeItem(LAST_KEY)
  } catch {
    /* private mode, or no storage — reopening is a convenience, not a feature */
  }
}

/**
 * Reopen whatever was on screen last time. A canvas deleted since then just
 * leaves an empty surface, which is the same as a first run.
 */
export async function restoreLastCanvas(): Promise<boolean> {
  let last: string | null = null
  try {
    last = localStorage.getItem(LAST_KEY)
  } catch {
    return false
  }
  if (!last) return false
  const ok = await openCanvas(last)
  if (!ok) {
    rememberLast(null)
    // A canvas that's gone isn't an error worth showing on an empty surface.
    useStore.setState({ canvasError: null })
  }
  return ok
}

export const listSavedCanvases = (): Promise<CanvasMeta[]> => listCanvases()

/**
 * Write the current graph to disk. Without a name the canvas keeps the one it
 * has; the first save of an unnamed canvas becomes "untitled".
 */
export async function saveCanvas(name?: string): Promise<boolean> {
  const s = useStore.getState()
  const id = s.canvasId ?? `canvas_${rid()}`
  const canvasName = (name ?? s.canvasName).trim() || 'untitled'
  const updatedAt = Date.now()

  // Snapshot first: a streaming turn can land more text while the write is in
  // flight, and that edit must not be marked as saved.
  const written = useStore.getState()
  try {
    await saveCanvasDoc({
      id,
      name: canvasName,
      updatedAt,
      version: CANVAS_VERSION,
      data: serializeCanvas(written),
    })
  } catch (e) {
    useStore.setState({ canvasError: String(e) })
    return false
  }

  const now = useStore.getState()
  rememberLast(id)
  useStore.setState({
    canvasId: id,
    canvasName,
    canvasSavedAt: updatedAt,
    canvasDirty:
      now.nodes !== written.nodes || now.edges !== written.edges || now.bus !== written.bus,
    canvasError: null,
  })
  return true
}

/**
 * Rename in place. A saved canvas is written straight away so the new name
 * survives a crash; an unsaved one just carries the name to its first save.
 */
export async function renameCanvas(name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (!trimmed) return false
  const s = useStore.getState()
  if (trimmed === s.canvasName) return true

  useStore.setState({ canvasName: trimmed })
  if (!s.canvasId) return true
  return saveCanvas(trimmed)
}

/** Save under a fresh id, leaving the canvas it was forked from untouched. */
export async function saveCanvasAs(name: string): Promise<boolean> {
  useStore.setState({ canvasId: null })
  return saveCanvas(name)
}

export async function openCanvas(id: string): Promise<boolean> {
  let doc
  try {
    doc = await loadCanvasDoc(id)
  } catch (e) {
    useStore.setState({ canvasError: String(e) })
    return false
  }

  const restored = deserializeCanvas(doc.data)
  rememberLast(doc.id)
  suppress(() =>
    useStore.setState({
      ...restored,
      // A saved canvas from another machine may carry no cwd; keep ours.
      cwd: restored.cwd || useStore.getState().cwd,
      canvasId: doc.id,
      canvasName: doc.name,
      canvasSavedAt: doc.updatedAt,
      canvasDirty: false,
      canvasError: null,
      canvasDialog: null,
      selectedId: null,
      openFilePath: null,
    }),
  )
  return true
}

/** Start over. The canvas on disk, if any, is left alone. */
export function newCanvas() {
  if (timer) clearTimeout(timer)
  rememberLast(null)
  suppress(() =>
    useStore.setState({
      nodes: [],
      edges: [],
      bus: [],
      delivered: {},
      selectedId: null,
      openFilePath: null,
      canvasId: null,
      canvasName: 'untitled',
      canvasSavedAt: null,
      canvasDirty: false,
      canvasError: null,
      canvasDialog: null,
    }),
  )
}

/** Delete a saved canvas. */
export async function deleteCanvas(id: string): Promise<boolean> {
  try {
    await deleteCanvasDoc(id)
  } catch (e) {
    useStore.setState({ canvasError: String(e) })
    return false
  }
  forgetIfOnScreen(id)
  return true
}

/**
 * Delete several at once, for clearing out canvases that have piled up.
 * One unreadable file shouldn't strand the rest, so a failure is recorded and
 * the sweep carries on; the caller gets the ids that actually went.
 */
export async function deleteCanvases(ids: string[]): Promise<string[]> {
  const gone: string[] = []
  const failed: string[] = []

  for (const id of ids) {
    try {
      await deleteCanvasDoc(id)
      gone.push(id)
      forgetIfOnScreen(id)
    } catch {
      failed.push(id)
    }
  }

  useStore.setState({
    canvasError: failed.length ? `could not delete ${failed.length} of ${ids.length}` : null,
  })
  return gone
}

/**
 * Deleting the canvas that's on screen leaves you on a fresh blank one.
 *
 * It used to just drop the id and keep the graph, on the theory that the work
 * shouldn't die with the file. But a graph with content and no file is exactly
 * what autosave exists to rescue: 1.2s later it minted a new id and wrote the
 * canvas straight back, under the same name. The row reappeared and the delete
 * looked broken. Clearing the board is both what the user asked for and the
 * only way the deletion sticks.
 */
function forgetIfOnScreen(id: string) {
  if (useStore.getState().canvasId !== id) return
  newCanvas()
}

/**
 * Track edits to the graph and autosave them.
 *
 * A canvas with content autosaves even when it has never been saved by hand:
 * it mints an id and lands as "untitled". Requiring an explicit first save
 * meant everything before that save could still be lost, which is exactly what
 * autosave is supposed to prevent. An *empty* canvas still writes nothing —
 * launching the app shouldn't litter the data dir with blank files.
 */
/**
 * Re-run the layout when the *set* of nodes changes — a node appearing or
 * disappearing. Deliberately not on every store change: re-laying out while an
 * agent streams would drag the canvas out from under whoever is reading it.
 * Moving a node by hand doesn't trigger it either, or tidy would fight the user.
 */
/**
 * Chime when the last working agent finishes.
 *
 * Per-agent would be noise on a busy canvas; the useful signal is that the
 * whole canvas has gone quiet and there's nothing left to wait for.
 */
export function watchCompletion(): () => void {
  const busyNow = () =>
    useStore
      .getState()
      .nodes.some(
        (n) => n.type === 'session' && (n.data.state === 'thinking' || n.data.state === 'streaming'),
      )

  let wasBusy = busyNow()

  return useStore.subscribe(() => {
    const isBusy = busyNow()
    if (justWentQuiet(wasBusy, isBusy)) playDone()
    wasBusy = isBusy
  })
}

export function watchLayout(): () => void {
  let known = new Set(useStore.getState().nodes.map((n) => n.id))
  let timer: ReturnType<typeof setTimeout> | null = null

  const unsubscribe = useStore.subscribe((s) => {
    const ids = new Set(s.nodes.map((n) => n.id))
    const changed = ids.size !== known.size || [...ids].some((id) => !known.has(id))
    known = ids
    if (!changed || !s.autoTidy || loading) return

    if (timer) clearTimeout(timer)
    // Long enough that a burst of file nodes settles into one pass.
    timer = setTimeout(() => {
      timer = null
      // Never reposition a node the user is holding.
      if (useStore.getState().nodes.some((n) => n.dragging)) return
      useStore.getState().tidy()
    }, 700)
  })

  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}

export function watchCanvas(): () => void {
  let seen = useStore.getState()

  const unsubscribe = useStore.subscribe((s) => {
    const changed = s.nodes !== seen.nodes || s.edges !== seen.edges || s.bus !== seen.bus
    seen = s
    if (!changed || loading) return

    if (!s.canvasDirty) useStore.setState({ canvasDirty: true })
    if (!s.nodes.length) {
      // Never let autosave write an empty graph. Reaching zero nodes is far
      // more often a bug or a mis-click than an edit worth persisting, and the
      // saved canvas is the only copy. An explicit save still goes through.
      if (!s.canvasId) return
      if (emptyGuardTripped !== s.canvasId) {
        emptyGuardTripped = s.canvasId
        console.warn('canvastrator: canvas is empty — autosave skipped to protect the saved copy')
      }
      return
    }
    emptyGuardTripped = null

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void saveCanvas()
    }, AUTOSAVE_MS)
  })

  return () => {
    if (timer) clearTimeout(timer)
    timer = null
    unsubscribe()
  }
}
