/**
 * The options an agent offered, pulled out of the question it asked.
 *
 * An agent that stops to ask something usually offers the ways out in the same
 * breath — a numbered list, a couple of bullets, or "A or B?" — and the reply
 * you send back is nearly always one of them, typed out again by hand. The
 * panel can only offer them as buttons if something turns that prose into a
 * list, so this does, conservatively: a wrong option is worse than no option,
 * because a wrong one gets clicked.
 *
 * Deliberately not a model call. This runs on every render of a panel while a
 * canvas is waiting, and an answer that arrives a second later than the
 * question is an answer nobody sees.
 */

export type Choice = {
  /** What the button says: the option, short enough to be a label. */
  label: string
  /** The rest of the line, when the agent explained the option. */
  note: string | null
}

/** As long as a label can be before it stops being one. */
const LABEL_MAX = 48

/** Lines that are numbering or bulleting a list rather than prose. */
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/

/** Bold or backticked lead-ins: "**Drop it** — the fallback is dead." */
const LEAD = /^(?:\*\*(.+?)\*\*|`(.+?)`)\s*[—:-]\s*(.+)$/

/** An option split from its explanation by a dash or colon. */
const SPLIT = /^(.{2,48}?)\s+[—–-]\s+(.+)$/

function clean(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
}

function toChoice(raw: string): Choice | null {
  const lead = LEAD.exec(raw)
  if (lead) {
    const label = clean(lead[1] ?? lead[2] ?? '')
    return label && label.length <= LABEL_MAX ? { label, note: clean(lead[3]) || null } : null
  }

  const split = SPLIT.exec(clean(raw))
  if (split) return { label: split[1], note: split[2] }

  const label = clean(raw)
  if (!label || label.length > LABEL_MAX) return null
  return { label, note: null }
}

/**
 * The listed options in a turn, or an empty array.
 *
 * A list is only a list of options if it has at least two items — one bullet
 * is a note, and the agent's question is not a menu just because it contains a
 * dash somewhere.
 */
function listed(text: string): Choice[] {
  const out: Choice[] = []
  for (const line of text.split('\n')) {
    const item = ITEM.exec(line)
    if (!item) continue
    const choice = toChoice(item[1])
    if (choice) out.push(choice)
  }
  return out.length >= 2 ? out.slice(0, 4) : []
}

/** "Should I do A or B?" — the other shape a question takes. */
const EITHER_OR = /\b(?:should i|do you want me to|shall i|would you rather)\b(.+?)\?/i

function alternatives(text: string): Choice[] {
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const tail = lines[lines.length - 1] ?? ''
  const asked = EITHER_OR.exec(tail)
  if (!asked) return []

  const parts = clean(asked[1])
    .split(/\s*,?\s+\bor\b\s+/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return []
  const choices = parts.map((p) => ({ label: p, note: null })).filter((c) => c.label.length <= LABEL_MAX)
  return choices.length >= 2 ? choices.slice(0, 4) : []
}

/**
 * Every option worth putting a button on, best shape first.
 *
 * A list beats an "A or B" reading of the same turn: an agent that took the
 * trouble to enumerate meant those exact options, while the alternatives in a
 * sentence are a guess at where the clauses divide.
 */
export function choicesFrom(text: string): Choice[] {
  if (!text.trim()) return []
  const list = listed(text)
  return list.length ? list : alternatives(text)
}
