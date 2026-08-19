/**
 * What a canvas has spent, and how full each agent's window is.
 *
 * Two different questions that look alike. Cost and token counts *accumulate*
 * over a session's life and answer "what did this cost". The context figure
 * does not accumulate — the whole conversation is resent every turn, so the
 * last turn's prompt size is the size of the conversation itself, and it is
 * the one number that predicts the failure you cannot recover from: a window
 * that fills up mid-task.
 *
 * Both live here rather than in the components that draw them, because the
 * canvas node and the bar at the top of the window must never disagree about
 * what a session has cost.
 */
import { contextLimit, type Provider } from './types'

export type SessionLike = {
  id: string
  name: string
  provider: Provider
  model?: string
  usage: { costUsd: number; inputTokens: number; outputTokens: number }
  contextTokens?: number
}

/** How full one session's context window is. */
export type ContextUse = {
  tokens: number
  /** Null when the model's window is unknown — see `contextLimit`. */
  limit: number | null
  /** 0–1, or null when there is no denominator to divide by. */
  fraction: number | null
}

/**
 * A session's context occupancy, or null before it has run a turn.
 *
 * Null rather than zero on purpose: an agent that has not run yet and an agent
 * whose provider reported no usage are both *unknown*, and drawing them as an
 * empty window would be a claim we cannot make.
 */
export function contextUse(s: SessionLike): ContextUse | null {
  if (s.contextTokens == null) return null
  const limit = contextLimit(s.provider, s.model)
  return {
    tokens: s.contextTokens,
    limit,
    fraction: limit ? Math.min(1, s.contextTokens / limit) : null,
  }
}

/**
 * How alarmed to be about a window.
 *
 * The thresholds are where behaviour changes rather than round numbers: past
 * three quarters a long turn can still finish but a long *task* probably
 * cannot, and past nine tenths the next turn is the one that fails. Below that
 * there is nothing to say, and a meter that is always shouting is a meter
 * nobody reads.
 */
export type ContextBand = 'calm' | 'warm' | 'hot'

export function band(fraction: number | null): ContextBand {
  if (fraction == null) return 'calm'
  if (fraction >= 0.9) return 'hot'
  if (fraction >= 0.75) return 'warm'
  return 'calm'
}

export type CanvasUsage = {
  sessions: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  /** The fullest window on the canvas, which is the one that will fail first. */
  tightest: { name: string; use: ContextUse } | null
}

/** Everything the canvas has spent, and its most-loaded agent. */
export function canvasUsage(sessions: SessionLike[]): CanvasUsage {
  let tightest: CanvasUsage['tightest'] = null

  for (const s of sessions) {
    const use = contextUse(s)
    if (!use) continue
    // Compared by fraction, since that is what "closest to failing" means. A
    // session whose window we don't know cannot enter the comparison at all —
    // it has no fraction, and ranking it by raw tokens would let a 90k prompt
    // on an unknown model outrank a genuinely full 190k one.
    if (use.fraction == null) continue
    if (!tightest || use.fraction > (tightest.use.fraction ?? 0)) {
      tightest = { name: s.name, use }
    }
  }

  return {
    sessions: sessions.length,
    costUsd: sessions.reduce((a, s) => a + s.usage.costUsd, 0),
    inputTokens: sessions.reduce((a, s) => a + s.usage.inputTokens, 0),
    outputTokens: sessions.reduce((a, s) => a + s.usage.outputTokens, 0),
    tightest,
  }
}

/**
 * Token counts, short enough to sit in a bar.
 *
 * Rounded rather than exact because nobody acts on the last three digits of a
 * token count, and an exact one changes width on every turn, which reads as
 * flicker in a status bar that is otherwise still.
 */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** Money, at a precision that suits how small these numbers usually are. */
export function fmtUsd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}
