/**
 * What an agent is doing, in three words.
 *
 * The smallest useful thing a node can say. At a zoom that fits a squad there
 * is room for exactly one line per agent, and "thinking" on all of them is the
 * same as saying nothing — the question a canvas of working agents raises is
 * *which* of them is on the file you care about, and which one has quietly
 * stopped.
 *
 * Derived from the tool calls the turn has already made, because that is the
 * only account of its work that arrives while the work is happening. The reply
 * text is what it will say afterwards.
 */
import type { Message, SessionNodeData } from './types'

export type LiveVerb = {
  text: string
  /** How to colour it: the agent's accent, or a state that outranks it. */
  tone: 'accent' | 'danger' | 'muted'
}

/** The last path-ish word of a tool detail — a file name, not a whole path. */
function tail(detail: string): string {
  const first = detail.trim().split(/\s+/)[0] ?? ''
  const cut = first.replace(/[`'"]/g, '').split('/').filter(Boolean).pop()
  return cut ?? ''
}

/**
 * A tool call as a verb phrase.
 *
 * The map is deliberately shallow and falls through to the tool's own name:
 * an MCP server can expose anything, and inventing a verb for a tool this
 * file has never heard of would be a guess rendered as fact.
 */
export function verbForTool(name: string, detail: string): string {
  const n = name.toLowerCase()
  const what = tail(detail)
  if (n === 'edit' || n === 'write' || n === 'multiedit' || n === 'notebookedit')
    return what ? `editing ${what}` : 'editing'
  if (n === 'read' || n === 'notebookread') return what ? `reading ${what}` : 'reading'
  if (n === 'bash' || n === 'shell' || n === 'run') {
    // The command, not its arguments: `bun test src/lib/store.test.ts` is
    // wider than the node and the first word is the part that identifies it.
    const cmd = detail.trim().split(/\s+/)[0]?.replace(/[`'"]/g, '')
    return cmd ? `running ${cmd}` : 'running a command'
  }
  if (n === 'grep' || n === 'glob' || n === 'search' || n === 'find') return 'searching'
  if (n === 'task' || n === 'agent') return 'delegating'
  if (n === 'webfetch' || n === 'websearch' || n === 'fetch') return 'reading the web'
  if (n === 'todowrite' || n === 'todoread') return 'planning'
  return name.toLowerCase()
}

/** The newest tool call in the turn still in flight, if there is one. */
function currentTool(messages: Message[]): { name: string; detail: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m.pending) break
    const t = m.tools.at(-1)
    if (t) return t
  }
  return null
}

/**
 * The one line a node leads with.
 *
 * Order matters and is not the order these states arrive in. A failure and a
 * question are things only you can clear, so they outrank any account of what
 * the agent was doing when it stopped — an agent that asked you something an
 * hour ago must not still be reporting the file it was reading at the time.
 */
export function liveVerb(d: Pick<SessionNodeData, 'state' | 'awaitingUser' | 'messages' | 'notice'>): LiveVerb {
  if (d.state === 'error') return { text: 'failed', tone: 'danger' }
  if (d.state === 'dead') return { text: 'process gone', tone: 'danger' }
  if (d.awaitingUser) return { text: 'waiting on you', tone: 'danger' }

  if (d.state === 'thinking' || d.state === 'streaming') {
    // A provider backing off is the one case where the app knows more about
    // why nothing is happening than the agent does. Silence during a 40-second
    // retry is indistinguishable from a hang, which is the whole point.
    if (d.notice) return { text: d.notice.label, tone: 'accent' }
    const tool = currentTool(d.messages)
    if (tool) return { text: verbForTool(tool.name, tool.detail), tone: 'accent' }
    return { text: d.state === 'streaming' ? 'replying' : 'thinking', tone: 'accent' }
  }

  // Idle. "Never run" and "finished" look identical from the outside and are
  // not the same thing to a user deciding what to do next.
  return d.messages.some((m) => m.role === 'assistant')
    ? { text: 'idle', tone: 'muted' }
    : { text: 'not started', tone: 'muted' }
}
