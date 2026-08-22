/**
 * The desk: every canvas that is open, side by side.
 *
 * A canvas used to be a document — one at a time, opening another closed the
 * first. But a canvas is a desk rather than a document: you leave a squad
 * working on one and go and start something else, and coming back to find the
 * work stopped is the thing that makes it useless. So they are all open at
 * once, laid out left to right in one strip, and moving between them is
 * scrolling rather than loading.
 *
 * Each one is its own store (see `createCanvasStore`), which is what makes
 * "still running" true rather than aspirational: an agent's events land on the
 * canvas whose node it is, whether or not that canvas is the one on screen.
 * This module owns only the *ordering* — which canvases exist, and which one
 * you are looking at.
 */
import { create } from 'zustand'
import { createCanvasStore, setActiveStore, type CanvasStore } from './store'
import type { AgentEvent } from './types'

/** One canvas on the desk. */
export type Seat = {
  /**
   * Its place in the strip, for React and for the dots.
   *
   * Minted here rather than taken from the saved canvas's id, because a canvas
   * that has never been saved has no id and is still a seat on the desk.
   */
  key: string
  store: CanvasStore
}

type Desk = {
  strip: Seat[]
  /** Which seat is in view. */
  at: number
}

let seq = 0

/**
 * A canvas, carrying over what is true of the machine rather than of a canvas.
 *
 * Which CLIs are installed, where the working directory starts, and the
 * persona library are facts about this computer — they are fetched once at
 * launch and landed on the canvas that happened to be open. A canvas opened
 * afterwards with none of them could not spawn anything at all: an empty
 * provider list reads as "no agent is installed", which is a lie the second
 * canvas of the session should not have to tell.
 */
function mint(from?: CanvasStore): Seat {
  const seat: Seat = { key: `seat_${++seq}`, store: createCanvasStore() }
  if (!from) return seat
  // Taken from a canvas already open rather than from a remembered "first"
  // one, which stops being on the desk the moment it is closed. Any open
  // canvas will do: they all inherited the same answers.
  const known = from.getState()
  seat.store.setState({ providers: known.providers, cwd: known.cwd, library: known.library })
  return seat
}

export const useDesk = create<Desk>(() => {
  const first = mint()
  setActiveStore(first.store)
  return { strip: [first], at: 0 }
})

/** The canvas in view. */
export const currentSeat = () => {
  const { strip, at } = useDesk.getState()
  return strip[Math.min(at, strip.length - 1)]
}

/**
 * Look at another canvas.
 *
 * Nothing is loaded or unloaded — every canvas on the strip is already live —
 * so this is only ever a change of view, and clamped rather than guarded
 * because the dots and the keyboard both aim at it.
 */
export function scrollTo(index: number) {
  const { strip } = useDesk.getState()
  const at = Math.max(0, Math.min(index, strip.length - 1))
  useDesk.setState({ at })
  setActiveStore(strip[at].store)
}

export const scrollBy = (delta: number) => scrollTo(useDesk.getState().at + delta)

/**
 * Put another canvas on the desk, to the right of the one in view, and go to
 * it. Returns its seat so a caller that is opening a *saved* canvas can fill
 * it in — the seat exists first, so the strip never flickers a gap.
 */
export function addSeat(): Seat {
  const seat = mint(currentSeat()?.store)
  const { strip, at } = useDesk.getState()
  const next = [...strip.slice(0, at + 1), seat, ...strip.slice(at + 1)]
  useDesk.setState({ strip: next, at: at + 1 })
  setActiveStore(seat.store)
  return seat
}

/**
 * Take a canvas off the desk.
 *
 * The last one is emptied rather than removed: a desk with no canvas on it has
 * nowhere to put the next node, and an app that can be closed into nothing is
 * a blank window with no way out of it.
 */
export function closeSeat(key: string) {
  const { strip, at } = useDesk.getState()
  const i = strip.findIndex((s) => s.key === key)
  if (i < 0) return
  if (strip.length === 1) {
    const fresh = mint(strip[0].store)
    useDesk.setState({ strip: [fresh], at: 0 })
    setActiveStore(fresh.store)
    return
  }
  const next = strip.filter((s) => s.key !== key)
  const to = Math.max(0, Math.min(at > i ? at - 1 : at, next.length - 1))
  useDesk.setState({ strip: next, at: to })
  setActiveStore(next[to].store)
}

/** The seat holding a given saved canvas, if it is already open. */
export const seatOfCanvas = (canvasId: string) =>
  useDesk.getState().strip.find((s) => s.store.getState().canvasId === canvasId)

/**
 * Deliver an agent's event to the canvas that owns it.
 *
 * The one thing that has to be true for a canvas to keep working while you are
 * looking at another one. Events arrive with a session id and nothing else, so
 * the seat is found by asking each canvas whether the session is one of its
 * own — which is cheap, and is the only place the strip is searched.
 *
 * An event for a session on no canvas is dropped, as it always was: the node
 * was deleted while its agent was mid-turn, and the reply has nowhere to land.
 */
export function routeEvent(sessionId: string, event: AgentEvent) {
  for (const seat of useDesk.getState().strip) {
    const has = seat.store
      .getState()
      .nodes.some((n) => n.type === 'session' && n.data.sessionId === sessionId)
    if (has) {
      seat.store.getState().applyEvent(sessionId, event)
      return
    }
  }
}
