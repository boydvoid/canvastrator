/**
 * The terminal emulators, kept outside React.
 *
 * A terminal's scrollback lives in its xterm instance, and React unmounts a
 * view every time you switch panels or click another node. Rebuild the
 * emulator on each mount and the history is gone — you would come back to a
 * blank screen with a build still running behind it. So the instances live
 * here, keyed by the node's terminal id, and the view borrows one: it attaches
 * the existing element to its container and hands it back on unmount.
 *
 * The shell itself lives in Rust for the same reason, one layer down. This is
 * the display; that is the process.
 */
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { onTerminalData, onTerminalExit, terminalWrite } from './bridge'

export type Attached = { term: Terminal; fit: FitAddon; element: HTMLDivElement }

const live = new Map<string, Attached>()

/** Started once, for every terminal at once — one listener, not one per view. */
let piped = false

/**
 * Theme read off the app's own CSS variables.
 *
 * Hard-coding a palette here would give one terminal that ignores the theme
 * switch; reading the variables means a terminal in light mode is a light
 * terminal, without this file knowing which themes exist.
 */
function themeFrom(root: HTMLElement) {
  const v = (name: string, fallback: string) =>
    getComputedStyle(root).getPropertyValue(name).trim() || fallback
  return {
    background: v('--color-panel', '#0b0b0d'),
    foreground: v('--color-fg', '#e6e6e6'),
    cursor: v('--color-fg', '#e6e6e6'),
    // Selection has to stay translucent or it hides the text under it.
    selectionBackground: 'rgba(128,128,128,0.35)',
  }
}

/**
 * The emulator for this terminal, made on first ask and kept afterwards.
 *
 * The element is created here rather than being the view's own node: it is the
 * thing that has to survive, and an element React owns is an element React will
 * throw away.
 */
export function emulatorFor(terminalId: string): Attached {
  const found = live.get(terminalId)
  if (found) return found

  const element = document.createElement('div')
  element.style.width = '100%'
  element.style.height = '100%'

  const term = new Terminal({
    fontFamily:
      '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    // Room to scroll back through a build without holding a session's worth of
    // memory per terminal.
    scrollback: 5000,
    cursorBlink: true,
    allowProposedApi: true,
    theme: themeFrom(document.documentElement),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(element)

  // Keystrokes go straight to the shell. Control characters included — ⌃C is
  // a byte on this channel like any other.
  term.onData((data) => void terminalWrite(terminalId, data).catch(() => {}))

  const attached = { term, fit, element }
  live.set(terminalId, attached)
  return attached
}

/** Wire the Rust output stream into whichever emulators exist. Idempotent. */
export function pipeTerminals(): () => void {
  if (piped) return () => {}
  piped = true

  const data = onTerminalData(({ terminalId, data }) => {
    live.get(terminalId)?.term.write(data)
  })
  const exit = onTerminalExit(({ terminalId, code }) => {
    // Written into the terminal rather than only onto the node: the scrollback
    // is where you are looking when a shell dies, and a screen that simply
    // stops responding is indistinguishable from one that is busy.
    live
      .get(terminalId)
      ?.term.write(`\r\n\x1b[2m[shell exited${code === null ? '' : ` (${code})`}]\x1b[0m\r\n`)
  })

  return () => {
    void data.then((f) => f())
    void exit.then((f) => f())
    piped = false
  }
}

/** Drop a terminal's emulator — its node was deleted, so its history goes too. */
export function forgetEmulator(terminalId: string) {
  const found = live.get(terminalId)
  if (!found) return
  found.term.dispose()
  live.delete(terminalId)
}

/** Re-read the theme, for every terminal on screen. Called when it changes. */
export function retheme() {
  const theme = themeFrom(document.documentElement)
  for (const { term } of live.values()) term.options.theme = theme
}

/** How many rows and columns the emulator currently has, after a fit. */
export function sizeOfTerminal(terminalId: string): { cols: number; rows: number } | null {
  const found = live.get(terminalId)
  return found ? { cols: found.term.cols, rows: found.term.rows } : null
}
