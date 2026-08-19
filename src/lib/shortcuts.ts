/**
 * Single-key shortcuts for the canvas surface. The keys mirror the right-click
 * menu one-for-one — the menu is the discoverable list, these are the fast path
 * — so anything added here needs a hint in the menu too.
 */

export type CanvasAction =
  | 'session'
  | 'folder'
  | 'file'
  | 'skill'
  | 'tidy'
  | 'rules'
  | 'delete'

/**
 * First letter wherever it is free; a mnemonic where it collides. File takes
 * "d" for document because folder already owns "f".
 */
const KEYS: Record<string, CanvasAction> = {
  s: 'session',
  f: 'folder',
  d: 'file',
  k: 'skill',
  t: 'tidy',
  g: 'rules',
  delete: 'delete',
  backspace: 'delete',
}

/** What the menu shows on the right of each item. */
export const SHORTCUT_LABEL: Record<CanvasAction, string> = {
  session: 'S',
  folder: 'F',
  file: 'D',
  skill: 'K',
  tidy: 'T',
  rules: 'G',
  delete: '⌫',
}

type KeyEventLike = {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

/**
 * The action a bare keypress asks for, or null. Modified keys belong to the
 * ⌘-shortcuts (save, open, tidy) and to the OS — never to this map.
 */
export function keyToCanvasAction(e: KeyEventLike): CanvasAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  return KEYS[e.key.toLowerCase()] ?? null
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Anything that swallows typing: fields, the Monaco editor, an open menu or
 * dialog, and the panels that mark themselves off-limits (chat, file viewer).
 */
const OFF_LIMITS =
  '[data-shortcuts="off"],[contenteditable="true"],[role="menu"],[role="dialog"],.monaco-editor'

type TargetLike = {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

/** True when a keypress is someone typing rather than a canvas command. */
export function shouldIgnoreShortcut(target: unknown): boolean {
  const el = target as TargetLike | null
  if (!el) return false
  if (el.tagName && TYPING_TAGS.has(el.tagName.toUpperCase())) return true
  if (el.isContentEditable) return true
  return typeof el.closest === 'function' ? el.closest(OFF_LIMITS) != null : false
}
