/**
 * One noticeboard the whole canvas reads.
 *
 * Context used to travel along the edge from one agent to another: what a
 * worker learned reached the orchestrator that spawned it and nobody else.
 * That is the right shape for a report and the wrong shape for a finding. On a
 * squad of five, "the migration renamed this column" is something all five
 * need, and wiring it agent-to-agent means either ten edges or four agents
 * rediscovering it — and, worse, means the sharing only happens if somebody
 * remembered to draw the line.
 *
 * So it is not wired at all. Every agent on the canvas reads everything on the
 * board, every turn, whether or not anything connects them. The only things
 * held back are what an agent has already been given and what it said itself.
 *
 * These are pure reads over the board. The store owns the writes; this owns
 * what any given agent is entitled to next turn, and what a reader should see.
 */
import type { ContextEntry } from './types'

/**
 * What an agent should be given next turn.
 *
 * Its own entries are excluded: an agent handed back its own summary would
 * spend a turn agreeing with itself. Everything else on the board is fair
 * game, oldest first, because that is the order it happened in.
 */
export function freshFor(
  bus: ContextEntry[],
  delivered: Set<string>,
  sessionId: string,
): ContextEntry[] {
  return bus.filter((e) => !delivered.has(e.id) && e.sessionId !== sessionId)
}

/**
 * How many agents have already been given an entry, and how many could be.
 *
 * The board's own readout: an entry every agent has read is settled, and one
 * nobody has read yet is about to change what four agents do next. Its author
 * is not counted on either side — it never needed telling.
 */
export function readCount(
  entry: ContextEntry,
  sessions: { sessionId: string }[],
  delivered: Record<string, Set<string>>,
): { read: number; of: number } {
  const others = sessions.filter((s) => s.sessionId !== entry.sessionId)
  return {
    read: others.filter((s) => delivered[s.sessionId]?.has(entry.id)).length,
    of: others.length,
  }
}

/** The board as a reader wants it: newest first. */
export function board(bus: ContextEntry[]): ContextEntry[] {
  return [...bus].reverse()
}

/** Name and description filter, for a board that has grown past a screenful. */
export function search(entries: ContextEntry[], query: string): ContextEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter(
    (e) => e.body.toLowerCase().includes(q) || e.sessionName.toLowerCase().includes(q),
  )
}
