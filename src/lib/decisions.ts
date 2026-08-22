/**
 * The orchestrator's decision path, read back out of its own transcript.
 *
 * A canvas shows *what happened* — agents, files, edges — and hides *why*. The
 * reasoning is in the orchestrator's replies, buried in prose: which shape it
 * chose and on what grounds, what it proposed, what the app refused and why,
 * which steps became real agents. That is the part you need when the answer
 * comes back wrong, and it is the part that scrolls away first.
 *
 * Derived, never stored. The transcript is the record; this is a reading of
 * it, the same way the plan nodes are a reading of the plan. Nothing to keep
 * in step, nothing to persist, and no way for this panel to claim a decision
 * the conversation does not contain.
 */
import { parsePattern, pattern, type PatternId } from './patterns'
import { parsePlan } from './plan'
import { parsePersonaDefinitions } from './persona-parse'
import type { Message, PlanStep } from './types'

export type Decision =
  /** What the user asked for. Starts each turn. */
  | { kind: 'ask'; id: string; text: string }
  /** The shape it declared, and the reason it gave. */
  | { kind: 'shape'; id: string; patternId: PatternId; label: string; why: string }
  /** A step it proposed, with the live state of that step when there is one. */
  | { kind: 'step'; id: string; persona: string; task: string; state?: PlanStep['state'] }
  /** A role it invented rather than reusing. */
  | { kind: 'persona'; id: string; name: string; description: string }
  /** The app pushing back: a refusal, a limit, a shape that did not hold up. */
  | { kind: 'note'; id: string; text: string }
  /** It answered instead of routing — a decision too, and often the right one. */
  | { kind: 'answer'; id: string; text: string }

/** Enough of a reply to recognise it, without pasting the whole thing. */
const gist = (text: string, max = 220) => {
  const clean = text
    .split('\n')
    // The `name:` form, not the bare word — "Spawn depth is per agent" is
    // prose about the protocol, and dropping it would silently swallow the
    // sentence that answers the question.
    .filter((l) => !/^[ \t]*(?:PATTERN|PLAN|SPAWN|DELEGATE)[ \t]+[\w.-]+[ \t]*:/i.test(l))
    .join('\n')
    .replace(/```[\s\S]*?```/g, '')
    .trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

/**
 * The decision path for one agent's conversation, oldest first.
 *
 * `live` is every step this agent's plans still hold, used only to colour in
 * the ones the transcript proposed: the transcript says what was asked for,
 * and the plans say what became of it. Steps from earlier turns keep no state,
 * because nothing kept it — showing them as pending would be inventing a fact.
 */
export function decisionsFor(messages: Message[], live: PlanStep[] = []): Decision[] {
  const out: Decision[] = []

  for (const m of messages) {
    if (m.role === 'user') {
      // Reports from workers arrive as user turns; they are results coming
      // back, not the user asking for something.
      if (m.text.startsWith('<canvastrator-report')) continue
      const text = gist(m.text, 160)
      if (text) out.push({ kind: 'ask', id: m.id, text })
      continue
    }

    if (m.role === 'system') {
      if (m.text.trim()) out.push({ kind: 'note', id: m.id, text: m.text })
      continue
    }

    if (m.pending) continue

    const shape = parsePattern(m.text)
    if (shape) {
      out.push({
        kind: 'shape',
        id: `${m.id}_shape`,
        patternId: shape.id,
        label: pattern(shape.id).name,
        why: shape.why,
      })
    }

    for (const p of parsePersonaDefinitions(m.text)) {
      out.push({
        kind: 'persona',
        id: `${m.id}_persona_${p.name}`,
        name: p.name,
        description: p.description,
      })
    }

    const steps = parsePlan(m.text)
    steps.forEach((s, i) => {
      // Matched on what it says, because that is all the transcript carries.
      // Two identical steps in one plan would share a state; they would also
      // be the same instruction twice, which is not a case worth complicating
      // this for.
      const held = live.find((x) => x.persona === s.persona && x.task === s.task)
      out.push({
        kind: 'step',
        id: `${m.id}_step_${i}`,
        persona: s.persona,
        task: s.task,
        ...(held ? { state: held.state } : {}),
      })
    })

    // Nothing proposed and nothing declared: it answered. Worth showing —
    // "it decided this needed no agents" is a decision, and the panel would
    // otherwise skip a turn entirely and look like it had lost one.
    if (!steps.length && !shape) {
      const text = gist(m.text)
      if (text) out.push({ kind: 'answer', id: m.id, text })
    }
  }

  return out
}
