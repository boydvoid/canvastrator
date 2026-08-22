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

/**
 * The last thing an agent said, or an empty string.
 *
 * Only assistant turns with text count: a turn that was nothing but tool calls
 * said nothing to you, and quoting its empty body under "waiting on you" would
 * be a banner with no question in it.
 */
export function lastSaid(messages: { role: string; text?: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.text?.trim()) return m.text
  }
  return ''
}

/**
 * The question out of a turn that ended in one.
 *
 * The same last-line rule `looksLikeQuestion` uses, for the same reason: an
 * agent that is actually waiting asks last, and the four paragraphs above the
 * question are the report, not the ask. Markdown decoration comes off because
 * this lands in a single line of a banner, where a stray `**` reads as a typo.
 */
export function questionTail(text: string): string {
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const tail = lines[lines.length - 1] ?? ''
  return tail
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/[*_`]/g, '')
    .trim()
}
