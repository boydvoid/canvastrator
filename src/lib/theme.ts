import { useSyncExternalStore } from 'react'

/**
 * What the user picked. `system` defers to the desktop, the other two pin it.
 * Dark is the default — Canvastrator shipped dark-only, and a first launch on a
 * light Mac shouldn't repaint an app the user has never seen in light.
 */
export type ThemePref = 'dark' | 'light' | 'system'

/** What actually gets painted. `system` resolves to one of these. */
export type Theme = 'dark' | 'light'

/** Same namespace as the sidebar's — these are window preferences, not state. */
const KEY = 'canvastrator.theme'

const PREFS: ThemePref[] = ['dark', 'light', 'system']

export const THEME_LABEL: Record<ThemePref, string> = {
  dark: 'dark',
  light: 'light',
  system: 'system',
}

/** Anything unrecognised — a hand-edited value, a key from a future version. */
export function parseThemePref(raw: string | null | undefined): ThemePref {
  return PREFS.includes(raw as ThemePref) ? (raw as ThemePref) : 'dark'
}

export function resolveTheme(pref: ThemePref, system: Theme): Theme {
  return pref === 'system' ? system : pref
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function systemTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

function readPref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(KEY))
  } catch {
    return 'dark'
  }
}

/**
 * Paint it. `data-theme` is what the palette in index.css keys off, and
 * `color-scheme` is what the webview keys off for the things CSS can't reach:
 * scrollbars, form controls, the canvas behind everything.
 *
 * index.html runs the same two assignments inline before the bundle loads, so
 * the first frame is already the right theme. This is the same work, repeated
 * whenever the choice changes.
 */
function paint(theme: Theme) {
  const el = document.documentElement
  el.dataset.theme = theme
  el.style.colorScheme = theme
  // The window's vibrancy is a native material and follows NSAppearance, not
  // our CSS — without this the sidebar stays dark behind a light app. Fails
  // harmlessly in a plain browser, where there's no window to ask.
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
    .catch(() => {})
}

let pref = typeof document === 'undefined' ? 'dark' : readPref()
const listeners = new Set<() => void>()

/** Cached because useSyncExternalStore compares snapshots by identity. */
let snapshot = { pref, theme: resolveTheme(pref, systemTheme()) }

function publish() {
  const theme = resolveTheme(pref, systemTheme())
  if (snapshot.pref === pref && snapshot.theme === theme) return
  snapshot = { pref, theme }
  paint(theme)
  for (const l of listeners) l()
}

export function setThemePref(next: ThemePref) {
  pref = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* no storage — the theme just forgets between launches */
  }
  publish()
}

if (typeof document !== 'undefined') {
  // The inline script in index.html has already set the attribute; this repeats
  // it to pick up the parts it can't do — the native window appearance.
  paint(snapshot.theme)
}

/**
 * Following the system means following it while the app is open, not only at
 * launch: flipping macOS to dark at sunset has to reach a running window.
 */
if (typeof matchMedia === 'function') {
  matchMedia(DARK_QUERY).addEventListener('change', publish)
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

const getSnapshot = () => snapshot

/** The resolved theme, for anything that can't be styled in CSS. */
export function subscribeTheme(onChange: (theme: Theme) => void) {
  onChange(snapshot.theme)
  return subscribe(() => onChange(snapshot.theme))
}

export function useTheme() {
  const { pref: current, theme } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { pref: current, theme, setPref: setThemePref }
}
