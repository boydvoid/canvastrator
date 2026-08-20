import { deleteCanvasDoc, listCanvases, loadCanvasDoc, saveCanvasDoc } from './bridge'
import {
  CANVAS_VERSION,
  deserializeCanvas,
  serializeCanvas,
  strandedPersonas,
  type CanvasMeta,
} from './persist'
import { personaFromNode } from './library'
import { DEFAULT_ORCHESTRA } from './types'
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

/**
 * Bumped whenever the canvas on screen is replaced — opened, cleared, deleted.
 *
 * A save is not instant, and what it does *after* the write is the dangerous
 * half: it records the id as the last canvas and writes it back into the
 * store. Do that for a canvas that was deleted while the write was in flight
 * and you have resurrected it — the pointer says to reopen it, and the next
 * launch does. Catching the id afterwards is not enough either, because a new
 * canvas can have been opened in the meantime and would be overwritten by the
 * finishing save. So the save takes a ticket, and hands nothing back if the
 * canvas moved on while it was away.
 */
let epoch = 0

/**
 * The write currently in flight, so a delete can wait for it.
 *
 * Ordering, not exclusion: without this, a save that started before the delete
 * lands after it, and writes the file straight back out of the snapshot it was
 * already holding. The delete then has nothing left to remove — it already ran.
 */
let pendingWrite: Promise<unknown> | null = null

/** Canvas id we've already warned about, so the log isn't spammed per edit. */
let emptyGuardTripped: string | null = null

/**
 * What the Rust side says when the file is simply gone. Anything else is a
 * canvas of the user's that failed to open, which is a different situation.
 */
const MISSING = 'canvas-missing'

/**
 * The window between the app starting and the launch restore settling.
 *
 * Autosave is watching before the restore has landed, and for that moment the
 * store looks exactly like a brand-new canvas: no id, and any node that
 * appears would mint one. That is one of the two ways the app used to grow an
 * "untitled" on every launch — the file it minted was orphaned a moment later
 * when the real canvas loaded over it, and stayed in the list for ever.
 */
let launchPending = false

/**
 * Set when the launch restore failed for a reason other than the file being
 * gone — an unreadable canvas, a bad write, a disk that did not answer.
 *
 * The other way an "untitled" appeared: the failure was swallowed, the pointer
 * to the canvas was thrown away, and the next node minted a fresh file. So the
 * user's canvas was still on disk, and their work carried on in a new one,
 * silently, every single launch. While this is set nothing may mint a new
 * canvas — the error is on screen, and starting a new one is a decision for
 * the user to make rather than a side effect of typing.
 */
let detached = false

/** Called synchronously at startup, before anything can be added to the graph. */
export function beginLaunchRestore() {
  launchPending = true
}

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
  try {
    let last: string | null = null
    try {
      last = localStorage.getItem(LAST_KEY)
    } catch {
      return false
    }
    if (!last) return false

    const ok = await openCanvas(last)
    if (ok) return true

    const why = useStore.getState().canvasError ?? ''
    if (why.includes(MISSING)) {
      // Deleted since last time. Nothing to say — an empty surface is the
      // same as a first run, and the pointer is dead weight.
      rememberLast(null)
      useStore.setState({ canvasError: null })
      return false
    }

    // It exists and would not open. Keep pointing at it: the file is the
    // user's work, and the next launch should try again rather than having
    // quietly moved on. Nothing autosaves until they choose what to do.
    detached = true
    useStore.setState({
      canvasError: `Couldn't open your last canvas — ${why}. Pick one from the sidebar, or start a new canvas. Nothing is being saved until you do.`,
    })
    return false
  } finally {
    launchPending = false
  }
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
  const mine = epoch
  try {
    const write = saveCanvasDoc({
      id,
      name: canvasName,
      updatedAt,
      version: CANVAS_VERSION,
      data: serializeCanvas(written),
    })
    pendingWrite = write
    try {
      await write
    } finally {
      if (pendingWrite === write) pendingWrite = null
    }
  } catch (e) {
    // A canvas that was deleted mid-write fails here on some paths; that is
    // the delete working, not an error to put in front of the user.
    if (mine === epoch) useStore.setState({ canvasError: String(e) })
    return false
  }

  // The canvas moved on while this was in flight — deleted, cleared, or
  // another one opened. The bytes are written and there is nothing to be done
  // about that, but this must not point the app back at it.
  if (mine !== epoch) return false

  const now = useStore.getState()
  rememberLast(id)
  useStore.setState({
    canvasId: id,
    canvasName,
    canvasSavedAt: updatedAt,
    canvasDirty:
      now.nodes !== written.nodes ||
      now.edges !== written.edges ||
      now.bus !== written.bus ||
      now.globalRules !== written.globalRules ||
      now.plan !== written.plan,
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
  rescuePersonas(doc.data)
  rememberLast(doc.id)
  detached = false
  epoch++
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

/**
 * Move any persona defined on an old canvas into the library before the node
 * carrying it is dropped. Matched by name, so opening the same canvas twice
 * doesn't duplicate anything, and a persona the user has since edited in the
 * library wins over the stale copy on the canvas.
 */
function rescuePersonas(data: Parameters<typeof strandedPersonas>[0]) {
  const stranded = strandedPersonas(data)
  if (!stranded.length) return

  const library = useStore.getState().library
  const known = new Set(library.map((p) => p.name.trim().toLowerCase()))
  const fresh = stranded
    .filter((d) => !known.has(d.name.trim().toLowerCase()))
    .filter((d, i, all) => all.findIndex((x) => x.name === d.name) === i)
    .map(personaFromNode)
  if (fresh.length) void useStore.getState().setLibrary([...library, ...fresh])
}

/** Start over. The canvas on disk, if any, is left alone. */
export function newCanvas() {
  if (timer) clearTimeout(timer)
  timer = null
  epoch++
  rememberLast(null)
  // An explicit fresh start is exactly the decision the detached state was
  // waiting for, so autosave may mint again.
  detached = false
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
      globalRules: '',
      plan: null,
      orchestra: { ...DEFAULT_ORCHESTRA },
    }),
  )
}

/**
 * Everything that has to stop before a file can be removed.
 *
 * A delete competes with autosave twice over: a debounced save may be seconds
 * from firing, and one may already be in flight holding a snapshot of the
 * canvas about to go. Both write the file back — so the row returns, or worse,
 * the file is gone from the list and back on disk, and the next launch reopens
 * the canvas the user deleted.
 */
async function quiesce() {
  if (timer) clearTimeout(timer)
  timer = null
  // A failed write is still a finished one, and that is all this waits for.
  await pendingWrite?.catch(() => {})
}

/** Delete a saved canvas. */
export async function deleteCanvas(id: string): Promise<boolean> {
  await quiesce()
  // Before the delete, so a save that slips in behind it knows the canvas has
  // moved on and keeps its hands off the pointer.
  if (useStore.getState().canvasId === id) epoch++

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
  await quiesce()
  if (ids.includes(useStore.getState().canvasId ?? '')) epoch++

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
    const changed =
      s.nodes !== seen.nodes ||
      s.edges !== seen.edges ||
      s.bus !== seen.bus ||
      s.globalRules !== seen.globalRules ||
      // A plan is work the user agreed to, or is about to; losing it to a
      // crash would mean reading the orchestrator's reasoning over again.
      s.plan !== seen.plan ||
      s.planning !== seen.planning ||
      s.orchestra !== seen.orchestra
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

    // Minting a *new* canvas is the only thing gated here. A canvas that
    // already has a file goes on saving to it either way — the risk being
    // guarded against is a second file, not a lost edit.
    if (!s.canvasId && (launchPending || detached)) return

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
