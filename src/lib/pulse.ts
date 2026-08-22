/**
 * One line per thing that happened, across every agent on the canvas.
 *
 * A node says what *it* is doing. Nothing said what the *canvas* was doing —
 * which agent asked a question two minutes ago, which one finished, which file
 * got written and by whom. Answering that meant opening agents one at a time
 * and reconstructing an order from nothing, which is exactly the work the
 * canvas was supposed to have already done.
 *
 * There is no second log for this. The notification feed was already a
 * timestamped, capped, newest-first record of turns, questions and failures
 * attributed to a node — a Pulse of three kinds. Pulse is that same log with
 * the rest of the kinds admitted, and the bell is now a filtered view of it
 * rather than the only view.
 */
import type { Notification, NotificationKind, Provider } from './types'

/**
 * What the bell shows.
 *
 * A prompt you typed and an agent you spawned are things you did — putting
 * them behind an unread badge asks you to acknowledge your own actions. The
 * bell keeps meaning "something happened while you were looking elsewhere".
 */
export const BELL_KINDS: NotificationKind[] = ['turn', 'question', 'error']

export function isBellKind(kind: NotificationKind): boolean {
  return BELL_KINDS.includes(kind)
}

/** The short word on the entry's chip. */
export const KIND_LABEL: Record<NotificationKind, string> = {
  prompt: 'prompt',
  shape: 'shape',
  spawned: 'spawned',
  turn: 'landed',
  question: 'needs you',
  error: 'failed',
  wrote: 'wrote',
  check: 'checked',
  compact: 'compacted',
}

/**
 * The colour an entry carries.
 *
 * `provider` means "take the agent's accent" — the same rule the canvas uses,
 * so an entry and the node it came from are visibly the same agent. The named
 * tokens are for events whose meaning outranks whose they are: a question and
 * a failure are the two things you must not scroll past.
 */
export type PulseTone = 'provider' | 'work' | 'attn' | 'danger' | 'live' | 'muted'

export const KIND_TONE: Record<NotificationKind, PulseTone> = {
  prompt: 'muted',
  shape: 'muted',
  spawned: 'provider',
  turn: 'provider',
  question: 'danger',
  error: 'danger',
  // The verdict decides the colour, not the kind — a check that passed and one
  // that failed are the same event and opposite news — so entries of this kind
  // carry their own tone. See `checkTone`.
  check: 'live',
  // Neither good news nor bad: a window was recycled and the work goes on.
  compact: 'muted',
  wrote: 'live',
}

/** Green for a pass, red for a fail: the one kind whose tone is its content. */
export function checkTone(headline: string): PulseTone {
  return headline.startsWith('checks pass') ? 'live' : 'danger'
}

export function toneColor(tone: PulseTone, provider?: Provider): string {
  switch (tone) {
    case 'work':
      return 'var(--color-work)'
    case 'attn':
      return 'var(--color-attn)'
    case 'danger':
      return 'var(--color-danger)'
    case 'live':
      return 'var(--color-live)'
    case 'provider':
      return provider ? `var(--color-${provider})` : 'var(--color-fg-subtle)'
    default:
      return 'var(--color-fg-subtle)'
  }
}

/**
 * What the canvas is doing right now, as counts.
 *
 * Deliberately not derived from the log: "working" is a live state, and a
 * record of past events cannot say whether the turn it recorded is still
 * going. The feed is history; this is the present, and they are computed from
 * different things on purpose.
 */
export type PulseNow = {
  working: number
  needsYou: number
  landed: number
  failed: number
}

/** Just enough of a session to count it. */
export type CountableSession = {
  state: string
  awaitingUser?: boolean
  /** Whether this agent has ever completed a turn. */
  ran: boolean
}

export function pulseNow(sessions: CountableSession[]): PulseNow {
  const now: PulseNow = { working: 0, needsYou: 0, landed: 0, failed: 0 }
  for (const s of sessions) {
    if (s.state === 'thinking' || s.state === 'streaming') now.working++
    else if (s.state === 'error') now.failed++
    else if (s.awaitingUser) now.needsYou++
    // An agent that has run, and is neither working, stuck, nor broken, has
    // landed. One that has never run is not "done" — it is unused, and
    // counting it as an outcome would make every fresh canvas claim results.
    else if (s.ran) now.landed++
  }
  return now
}

/** The sentence at the top of the module, with the empty case handled. */
export function nowSentence(now: PulseNow): string {
  const parts: string[] = []
  if (now.working) parts.push(`${now.working} working`)
  if (now.needsYou) parts.push(`${now.needsYou} needs you`)
  if (now.failed) parts.push(`${now.failed} failed`)
  if (now.landed) parts.push(`${now.landed} landed`)
  return parts.length ? parts.join(' · ') : 'nothing running'
}

/**
 * The proportions of the state bar, in the order the counts name them.
 *
 * One segment per state, and every state gets its own colour: working is
 * `work`, waiting on you is `attn`, failed is `danger`, landed is `live`.
 * Questions and failures used to share the danger red, which made a canvas
 * with one question look like a canvas with one broken agent — the two need
 * opposite reactions.
 *
 * Returns null when there is nothing to draw rather than an array of zeroes,
 * so the bar is absent on an idle canvas instead of being a grey rule that
 * looks like a loading state.
 */
export function stateBar(now: PulseNow): { tone: PulseTone; fraction: number }[] | null {
  const total = now.working + now.needsYou + now.failed + now.landed
  if (!total) return null
  return (
    [
      { tone: 'work' as const, n: now.working },
      { tone: 'attn' as const, n: now.needsYou },
      { tone: 'danger' as const, n: now.failed },
      { tone: 'live' as const, n: now.landed },
    ] satisfies { tone: PulseTone; n: number }[]
  )
    .filter((s) => s.n > 0)
    .map((s) => ({ tone: s.tone, fraction: s.n / total }))
}

/**
 * Elapsed time for a feed you scan rather than read.
 *
 * Seconds up to a minute, because the top of the feed is usually something
 * that started moments ago and a coarser unit would hide the difference
 * between four seconds and forty. `timeAgo` in `ago.ts` answers the other
 * question — how stale is this — and is deliberately coarser.
 */
export function elapsed(at: number, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - at) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m${String(secs % 60).padStart(2, '0')}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h${String(mins % 60).padStart(2, '0')}`
  return `${Math.floor(hours / 24)}d`
}

/**
 * How long the run has been going, measured from the oldest entry still in
 * the feed.
 *
 * Null on an empty feed. Note the cap: on a canvas that has produced more than
 * `MAX_NOTIFICATIONS` events this measures the window the feed still holds,
 * not the whole session — which is the honest thing for a figure rendered
 * next to that feed.
 */
export function runSince(feed: Notification[]): number | null {
  return feed.length ? feed[feed.length - 1].ts : null
}
