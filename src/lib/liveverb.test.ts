import { describe, expect, it } from 'vitest'
import { liveVerb, verbForTool } from './liveverb'
import type { Message, SessionNodeData } from './types'

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm',
  role: 'assistant',
  text: '',
  tools: [],
  ...over,
})

const session = (over: Partial<SessionNodeData> = {}) =>
  ({ state: 'idle', messages: [], ...over }) as SessionNodeData

describe('verbForTool', () => {
  it('names the file, not the path', () => {
    expect(verbForTool('Edit', 'src/lib/store.ts')).toBe('editing store.ts')
    expect(verbForTool('Read', '/Users/you/dev/orbit/README.md')).toBe('reading README.md')
  })

  it('takes the command from a shell call, not its arguments', () => {
    // `bun test src/lib/store.test.ts` is wider than the node, and the first
    // word is the part that identifies it.
    expect(verbForTool('Bash', 'bun test src/lib/store.test.ts')).toBe('running bun')
  })

  it('falls through to the tool name for anything it has not heard of', () => {
    // An MCP server can expose anything; inventing a verb would be a guess
    // rendered as fact.
    expect(verbForTool('linear_create_issue', '')).toBe('linear_create_issue')
  })

  it('copes with a detail it cannot parse', () => {
    expect(verbForTool('Edit', '')).toBe('editing')
    expect(verbForTool('Bash', '   ')).toBe('running a command')
  })
})

describe('liveVerb', () => {
  it('reports the tool a running turn is on', () => {
    const v = liveVerb(
      session({
        state: 'streaming',
        messages: [msg({ pending: true, tools: [{ name: 'Read', detail: 'a.ts' }, { name: 'Edit', detail: 'b.ts' }] })],
      }),
    )
    expect(v).toEqual({ text: 'editing b.ts', tone: 'accent' })
  })

  it('prefers a provider notice to the tool, so a backoff is not silence', () => {
    const v = liveVerb(
      session({
        state: 'thinking',
        notice: { label: 'retry 3/10', detail: 'overloaded' },
        messages: [msg({ pending: true, tools: [{ name: 'Read', detail: 'a.ts' }] })],
      }),
    )
    expect(v.text).toBe('retry 3/10')
  })

  it('puts a question above whatever it was doing when it stopped', () => {
    // An agent that asked you something an hour ago must not still be
    // reporting the file it was reading at the time.
    const v = liveVerb(
      session({
        state: 'idle',
        awaitingUser: true,
        messages: [msg({ text: 'Which one?', tools: [{ name: 'Read', detail: 'a.ts' }] })],
      }),
    )
    expect(v).toEqual({ text: 'waiting on you', tone: 'danger' })
  })

  it('puts a failure above a pending question', () => {
    const v = liveVerb(session({ state: 'error', awaitingUser: true }))
    expect(v).toEqual({ text: 'failed', tone: 'danger' })
  })

  it('distinguishes an agent that finished from one that never ran', () => {
    expect(liveVerb(session({ messages: [msg({ text: 'Done.' })] })).text).toBe('idle')
    expect(liveVerb(session()).text).toBe('not started')
    // A user message alone is not a turn — nothing has replied to it.
    expect(liveVerb(session({ messages: [msg({ role: 'user', text: 'Go' })] })).text).toBe(
      'not started',
    )
  })

  it('says something while a turn is starting and no tool has been called', () => {
    expect(liveVerb(session({ state: 'thinking', messages: [msg({ pending: true })] })).text).toBe(
      'thinking',
    )
    expect(
      liveVerb(session({ state: 'streaming', messages: [msg({ pending: true, text: 'So ' })] })).text,
    ).toBe('replying')
  })

  it('ignores tools from a finished turn when a new one has called none yet', () => {
    const v = liveVerb(
      session({
        state: 'thinking',
        messages: [
          msg({ text: 'Done.', tools: [{ name: 'Edit', detail: 'old.ts' }] }),
          msg({ pending: true }),
        ],
      }),
    )
    expect(v.text).toBe('thinking')
  })
})
