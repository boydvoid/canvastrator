/**
 * How much of an agent a node shows.
 *
 * The canvas has one job — say what is going on — and the honest answer is a
 * different length depending on how much of the canvas you are looking at. At
 * a zoom that fits twenty agents, a transcript is unreadable and a name is
 * not enough; the useful thing is one verb. At working zoom the useful thing
 * is the last turn in the agent's own words. Reading the conversation is a
 * decision you make about one agent, not a size the canvas picks for you.
 *
 * So density is derived from zoom, and a node can pin itself out of that.
 */

export type Density = 'glance' | 'summary' | 'full'

/**
 * Below this zoom a summary node's body type is smaller than the dot grid
 * behind it, so the text is texture rather than information. That is the
 * point at which the node should stop pretending to be readable and say the
 * one thing that survives: what it is doing.
 */
export const GLANCE_BELOW = 0.5

/**
 * The nominal box each density occupies.
 *
 * Used by the layout pass, which has to place nodes before React Flow has
 * measured them. Heights are approximate — a node's real height comes from its
 * content — but the widths are exact, because a column of agents whose widths
 * disagree reads as a mistake.
 */
export const DENSITY_SIZE: Record<Density, { w: number; h: number }> = {
  glance: { w: 260, h: 56 },
  summary: { w: 300, h: 186 },
  full: { w: 440, h: 420 },
}

/** The density a zoom level asks for, with nothing pinned. */
export function densityForZoom(zoom: number): Density {
  return zoom < GLANCE_BELOW ? 'glance' : 'summary'
}

/**
 * What a node should render.
 *
 * `full` is never reached by zooming — there is no zoom at which every agent
 * on the canvas should open its transcript — so it only ever arrives as a pin.
 */
export function densityOf(pinned: Density | undefined, zoom: number): Density {
  return pinned ?? densityForZoom(zoom)
}

/** The next density in the ladder, for the toggle on the node's footer. */
export function cycleDensity(current: Density): Density {
  return current === 'glance' ? 'summary' : current === 'summary' ? 'full' : 'glance'
}

/** Anything unrecognised — a hand-edited canvas, or a key from a later version. */
export function parseDensity(raw: unknown): Density | undefined {
  return raw === 'glance' || raw === 'summary' || raw === 'full' ? raw : undefined
}
