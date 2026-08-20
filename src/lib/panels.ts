import { useSyncExternalStore } from 'react'

/**
 * The panel row's window preferences: how wide each navigation column is, and
 * whether the group is showing at all. These are window state, not canvas
 * content — resizing a column must never mark a canvas dirty.
 *
 * Replaces the old `sidebar.ts`, whose single collapsed flag is read once on
 * first run so an existing preference carries over.
 */

/** The navigation columns, left to right, that sit between the app edge and the flow region. */
export type PanelKey = 'canvases' | 'chats' | 'files'

/** Whether the Files column follows the selected chat or shows the whole canvas. */
export type FilesScope = 'chat' | 'all'

/**
 * How much of the column group fits. Tiers are derived, not hardcoded to
 * window widths: each one is a step taken to keep the flow region above its
 * floor. See `tierFor`.
 */
export type Tier = 'full' | 'compact' | 'merged' | 'rail'

export type PanelWidths = Record<PanelKey, number>

export type PanelPrefs = {
  widths: PanelWidths
  /** The three columns hide as one group — ⌘\ is a single gesture, as it was. */
  collapsed: boolean
  filesScope: FilesScope
  flowFocus: boolean
}

export const PANEL_RANGE: Record<PanelKey, { min: number; max: number; default: number }> = {
  canvases: { min: 160, max: 320, default: 200 },
  chats: { min: 180, max: 320, default: 220 },
  files: { min: 200, max: 400, default: 260 },
}

/**
 * The one number the responsive behaviour is derived from. Session nodes are a
 * fixed 400×340 from birth (`store.ts` `addSession`), so below ~480 the flow
 * region cannot show a single node, let alone a graph.
 */
export const FLOW_MIN = 480

/** A collapsed column keeps an icon rail this wide. */
export const RAIL_W = 44

/** The `gap-2` between the floating panels. */
export const GAP = 8

const KEY = 'canvastrator.panels'
const LEGACY_COLLAPSED_KEY = 'canvastrator.sidebarCollapsed'

const DEFAULT_WIDTHS: PanelWidths = {
  canvases: PANEL_RANGE.canvases.default,
  chats: PANEL_RANGE.chats.default,
  files: PANEL_RANGE.files.default,
}

export const PANEL_KEYS = Object.keys(PANEL_RANGE) as PanelKey[]

/** A width the user dragged is only honoured inside the column's own range. */
export function clampWidth(key: PanelKey, px: number): number {
  const { min, max } = PANEL_RANGE[key]
  return Math.min(max, Math.max(min, Math.round(px)))
}

/** Which columns each tier puts on screen, in step-down order. */
const TIER_COLUMNS: { tier: Tier; widths: (w: PanelWidths) => number[] }[] = [
  { tier: 'full', widths: (w) => [w.canvases, w.chats, w.files] },
  // Canvases → icon rail: the least-often-used column, and the one with a
  // legible icon-only form.
  { tier: 'compact', widths: (w) => [RAIL_W, w.chats, w.files] },
  // Chats and Files merge into one tabbed column, sized by the wider of them.
  { tier: 'merged', widths: (w) => [RAIL_W, w.files] },
  // Everything is a rail; the columns open as drawers over the flow.
  { tier: 'rail', widths: () => [RAIL_W] },
]

/** What the column group costs at a tier, including the gap after each column. */
export function columnsWidth(tier: Tier, widths: PanelWidths = DEFAULT_WIDTHS): number {
  const entry = TIER_COLUMNS.find((t) => t.tier === tier) ?? TIER_COLUMNS[0]
  return entry.widths(widths).reduce((total, w) => total + w + GAP, 0)
}

/**
 * Step down until the flow region clears `FLOW_MIN`.
 *
 * `rowWidth` is the space available to the columns *and* the flow region —
 * the panel row minus the right dock, which collapses on its own and so can't
 * be assumed. `rail` is the floor: below it there is nothing left to give up.
 */
export function tierFor(rowWidth: number, widths: PanelWidths = DEFAULT_WIDTHS): Tier {
  for (const { tier } of TIER_COLUMNS) {
    if (rowWidth - columnsWidth(tier, widths) >= FLOW_MIN) return tier
  }
  return 'rail'
}

/** Anything unrecognised — a hand-edited value, or a key from a future version. */
export function parsePanels(raw: string | null | undefined, legacyCollapsed = false): PanelPrefs {
  const prefs: PanelPrefs = {
    widths: { ...DEFAULT_WIDTHS },
    collapsed: legacyCollapsed,
    filesScope: 'chat',
    flowFocus: false,
  }
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    return prefs
  }
  if (!parsed || typeof parsed !== 'object') return prefs
  const p = parsed as Partial<PanelPrefs>
  if (p.widths && typeof p.widths === 'object') {
    for (const key of PANEL_KEYS) {
      const w = p.widths[key]
      if (typeof w === 'number' && Number.isFinite(w)) prefs.widths[key] = clampWidth(key, w)
    }
  }
  if (typeof p.collapsed === 'boolean') prefs.collapsed = p.collapsed
  if (p.filesScope === 'chat' || p.filesScope === 'all') prefs.filesScope = p.filesScope
  if (typeof p.flowFocus === 'boolean') prefs.flowFocus = p.flowFocus
  return prefs
}

function read(): PanelPrefs {
  try {
    return parsePanels(localStorage.getItem(KEY), localStorage.getItem(LEGACY_COLLAPSED_KEY) === '1')
  } catch {
    return parsePanels(null)
  }
}

let prefs: PanelPrefs = typeof document === 'undefined' ? parsePanels(null) : read()
const listeners = new Set<() => void>()

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* no storage — the panels just forget between launches */
  }
}

function publish(next: PanelPrefs, persist = true) {
  prefs = next
  if (persist) save()
  for (const l of listeners) l()
}

/**
 * `persist: false` is for a drag in flight — the width has to be live on every
 * pointermove, but only the released value is worth writing.
 */
export function setPanelWidth(key: PanelKey, px: number, persist = true) {
  publish({ ...prefs, widths: { ...prefs.widths, [key]: clampWidth(key, px) } }, persist)
}

export function commitPanels() {
  save()
}

export function resetPanelWidth(key: PanelKey) {
  setPanelWidth(key, PANEL_RANGE[key].default)
}

export function togglePanels() {
  publish({ ...prefs, collapsed: !prefs.collapsed })
}

export function setFilesScope(filesScope: FilesScope) {
  publish({ ...prefs, filesScope })
}

export function setFlowFocus(flowFocus: boolean) {
  publish({ ...prefs, flowFocus })
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

const getSnapshot = () => prefs

export function usePanels() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * ⌘B and ⌘\ both toggle the sidebar.
 *
 * ⌘\ is the older mac convention and stays bound so nothing anyone has in
 * their fingers breaks; ⌘B is what editors use and is what this app is asked
 * for. Bound once, at module level: a hook would bind it again for every
 * column that reads the prefs, and the group would toggle once per listener.
 *
 * Not gated on `shouldIgnoreShortcut` — unlike the bare-letter canvas keys,
 * a modified chord is not something you type into a field by accident, and
 * hiding a panel is exactly what you want while the cursor is in one.
 */
const SIDEBAR_KEYS = ['b', '\\']

/** The chord itself, split out so it can be tested without a DOM. */
export function isSidebarChord(e: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false
  return SIDEBAR_KEYS.includes(e.key.toLowerCase())
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!isSidebarChord(e)) return
      e.preventDefault()
      togglePanels()
    },
    true,
  )
}
