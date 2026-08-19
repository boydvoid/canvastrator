/**
 * Whether a finished turn was actually a question.
 *
 * An agent that stops to ask something looks exactly like one that finished —
 * the state pill says `idle` either way — so a canvas can sit waiting on you
 * with nothing saying so. This is a heuristic, deliberately conservative: a
 * false positive puts a "waiting" badge on a finished turn, which is mildly
 * wrong, while a false negative leaves the canvas silently stalled.
 */

/** Phrases that ask for a decision without ending in a question mark. */
const ASKS = [
  /\blet me know\b/i,
  /\bwhich (one|would|do) you\b/i,
  /\bshould i\b/i,
  /\bwould you like\b/i,
  /\bdo you want\b/i,
  /\bconfirm\b.{0,20}\bbefore\b/i,
  /\bwaiting (for|on) (your|you)\b/i,
  /\btell me\b.{0,30}\band i(?:'|’)ll\b/i,
]

export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  // Only the last line decides. A question earlier in a report was rhetorical,
  // or was answered by the work that followed it — an agent that is actually
  // waiting asks last.
  const lines = trimmed.split('\n').filter((l) => l.trim())
  const tail = lines[lines.length - 1] ?? ''

  // A code fence ending in `?` is not the agent asking anything.
  const withoutCode = tail.replace(/`[^`]*`/g, '')
  if (/\?\s*$/.test(withoutCode.trim())) return true

  return ASKS.some((re) => re.test(withoutCode))
}
