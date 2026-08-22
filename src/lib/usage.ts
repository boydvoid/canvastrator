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

/**
 * What the canvas is spending, per ten minutes.
 *
 * A total answers "what did this cost" after the fact. While a squad is
 * running, the question is whether to let it keep going, and that is a rate.
 * Ten minutes rather than an hour because that is roughly the length of a
 * task you would let run unattended — an hourly figure asks you to divide.
 *
 * Null under a minute of elapsed time: a rate extrapolated from twenty seconds
 * of a squad's first turn is a number with no information in it, and showing
 * one that swings by an order of magnitude every few seconds trains people to
 * ignore the field.
 */
export const BURN_WINDOW_MS = 10 * 60 * 1000
const MIN_ELAPSED_MS = 60 * 1000

export function burnRate(costUsd: number, elapsedMs: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < MIN_ELAPSED_MS) return null
  return (costUsd / elapsedMs) * BURN_WINDOW_MS
}

/**
 * Each agent's share of the spend, largest first.
 *
 * Ordered by cost rather than by name or by spawn order: the reason to look at
 * this is to find the agent that ran away with the budget, and putting it
 * anywhere but first makes you read the whole list to find it.
 */
export type Share = { id: string; name: string; provider: Provider; costUsd: number; fraction: number }

export function spendByAgent(sessions: SessionLike[]): Share[] {
  const total = sessions.reduce((a, s) => a + s.usage.costUsd, 0)
  return sessions
    .map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      costUsd: s.usage.costUsd,
      // Zero total means every share is zero, not NaN — a fresh canvas draws
      // an empty bar rather than nothing at all.
      fraction: total > 0 ? s.usage.costUsd / total : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
}

/**
 * How long until a window resets, in the coarsest unit that is still useful.
 *
 * A reset is a deadline you plan around rather than watch tick: minutes matter
 * in the last hour, hours matter for the rest of a session window, and a
 * weekly window is answered in days. Null for a window that has never been
 * touched — it has no reset because nothing has started it.
 */
export function untilReset(resetsAt: string | null, now = Date.now()): string | null {
  if (!resetsAt) return null
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return null
  const ms = at - now
  // A window whose reset has passed is a window the next turn will refresh;
  // saying "now" beats a negative countdown or a stale figure.
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return mins % 60 === 0 ? `${hours}h` : `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

/**
 * How alarmed to be about a plan window, on the same ladder as a context one.
 *
 * Deliberately the same thresholds as `band`: two meters in one panel that
 * turn amber at different places would teach nothing about either.
 */
export function planBand(percent: number): ContextBand {
  return band(percent / 100)
}
