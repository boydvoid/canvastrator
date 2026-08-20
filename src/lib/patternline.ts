/**
 * An orchestrator's reply, split into the prose and the machinery.
 *
 * The reply is one string, but it is not one kind of thing. `PATTERN single:
 * …` is a decision, `SPAWN reviewer: …` is an action, a persona fence is a
 * definition — and rendered as markdown all three come out as paragraphs the
 * user is left to parse by eye. The screenshot that prompted this had a
 * PATTERN line wrapping as body text above the reply it governed, which is
 * exactly backwards: the shape is the headline, not a footnote.
 *
 * Parsing lives here, apart from the components, so the rendering stays dumb
 * and the boundaries can be tested without a DOM. The boundaries are the whole
 * risk: a card that shows something other than what the store actually parsed
 * is worse than no card, so the shapes below deliberately match `parsePattern`
 * in `./patterns` and `parseSpawn` in `../lib/store` rather than being a
 * second, prettier reading of the same text.
 */
import { pattern, toPatternId, type PatternId } from './patterns'

export type Segment =
  /** Ordinary message prose. Rendered exactly as it was before any of this. */
  | { kind: 'text'; text: string }
  /** The shape it declared, and the reason it gave for that shape. */
  | { kind: 'pattern'; id: PatternId; label: string; why: string }
  /** A worker it asked for. The task runs to the next directive or the end. */
  | { kind: 'spawn'; name: string; task: string }
  /** A role it invented rather than reusing. */
  | { kind: 'persona'; name: string; fields: Record<string, string>; brief: string }

/**
 * `SPAWN`/`DELEGATE` at the start of a line, never mid-sentence.
 *
 * "Do not write a SPAWN for it" is prose about the protocol, and a sentence
 * containing the word is not an instruction to start an agent.
 */
const SPAWN_LINE = /^[ \t]*(SPAWN|DELEGATE)[ \t]+([\w.-]+)[ \t]*:[ \t]*/i

/**
 * `PATTERN <id>: <why>` on a line of its own.
 *
 * `\S` on the rationale because a bare `PATTERN single:` declares nothing —
 * a badge with no reason beside it is the label without the argument, which
 * is the half of the line that does the work. Line-anchored for the same
 * reason as `SPAWN_LINE`.
 */
const PATTERN_LINE = /^[ \t]*PATTERN[ \t]+([\w-]+)[ \t]*:[ \t]*(\S.*?)[ \t]*$/i

const PERSONA_FENCE = /```canvastrator-persona\s*\n([\s\S]*?)```/gi

/**
 * Split a reply into prose and directives.
 *
 * The task on a `SPAWN` runs to the end of the reply or to the next directive,
 * matching how the store parses it — the card must show exactly what the child
 * was actually sent, not a prettier summary of it. A `PATTERN` line inside a
 * spawn's task body is therefore left alone: it belongs to the brief the child
 * received, and lifting it out into a badge would show the user a decision the
 * orchestrator never made.
 *
 * Only the first `PATTERN` becomes a badge. `parsePattern` takes the first one
 * and ignores the rest, so a second badge would advertise a shape nothing ran
 * under; the later line stays as the plain text it effectively is.
 */
export function splitAgentText(text: string): Segment[] {
  const out: Segment[] = []
  const rest = text

  // Persona definitions first: they're fenced, so their boundaries are exact.
  const fences: { start: number; end: number; seg: Segment }[] = []
  for (const m of rest.matchAll(PERSONA_FENCE)) {
    const body = m[1]
    const cut = body.search(/^\s*---\s*$/m)
    const head = cut === -1 ? body : body.slice(0, cut)
    const brief = cut === -1 ? '' : body.slice(cut).replace(/^\s*---\s*$/m, '').trim()
    const fields: Record<string, string> = {}
    for (const line of head.split('\n')) {
      const kv = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i)
      if (kv) fields[kv[1].toLowerCase()] = kv[2].trim()
    }
    if (fields.name) {
      fences.push({
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
        seg: { kind: 'persona', name: fields.name, fields, brief },
      })
    }
  }

  let seenPattern = false
  const pushText = (chunk: string) => {
    if (chunk.trim()) out.push({ kind: 'text', text: chunk.trim() })
  }

  const emitDirectives = (chunk: string) => {
    const lines = chunk.split('\n')
    let buffer: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const shape = !seenPattern ? lines[i].match(PATTERN_LINE) : null
      if (shape) {
        const id = toPatternId(shape[1])
        // An id that isn't one of the six is not a shape. Badging it would put
        // the app's guess where the orchestrator's name should be, so it stays
        // prose — visibly wrong, which is the point.
        if (id) {
          pushText(buffer.join('\n'))
          buffer = []
          seenPattern = true
          out.push({ kind: 'pattern', id, label: pattern(id).name, why: shape[2].trim() })
          continue
        }
      }

      const m = lines[i].match(SPAWN_LINE)
      if (!m) {
        buffer.push(lines[i])
        continue
      }
      pushText(buffer.join('\n'))
      buffer = []
      // Everything after the directive belongs to it, until the next one.
      const first = lines[i].slice(m[0].length)
      const task: string[] = first ? [first] : []
      while (i + 1 < lines.length && !SPAWN_LINE.test(lines[i + 1])) {
        task.push(lines[++i])
      }
      out.push({ kind: 'spawn', name: m[2], task: task.join('\n').trim() })
    }
    pushText(buffer.join('\n'))
  }

  let cursor = 0
  for (const f of fences) {
    emitDirectives(rest.slice(cursor, f.start))
    out.push(f.seg)
    cursor = f.end
  }
  emitDirectives(rest.slice(cursor))

  return out
}
