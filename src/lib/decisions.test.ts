import { describe, expect, it } from 'vitest'
import { decisionsFor } from './decisions'
import type { Message, PlanStep } from './types'

const msg = (role: Message['role'], text: string, over: Partial<Message> = {}): Message => ({
  id: `m_${role}_${text.slice(0, 8)}_${Math.random().toString(36).slice(2, 6)}`,
  role,
  text,
  tools: [],
  ...over,
})

describe('decisionsFor', () => {
  it('reads a turn as ask → shape → steps, in that order', () => {
    const d = decisionsFor(
      [
        msg('user', 'Review the auth path'),
        msg(
          'assistant',
          'PATTERN parallel: the three files are independent.\nPLAN reviewer: read src/auth.ts\nPLAN reviewer: read src/env.ts',
        ),
      ],
    )
    expect(d.map((x) => x.kind)).toEqual(['ask', 'shape', 'step', 'step'])
    expect(d[1]).toMatchObject({ label: 'parallelisation', why: 'the three files are independent.' })
    expect(d[2]).toMatchObject({ persona: 'reviewer', task: 'read src/auth.ts' })
  })

  it('colours in a step the live plan still holds, and leaves older ones bare', () => {
    const messages = [msg('assistant', 'PLAN implementer: add the button')]
    const withPlan = decisionsFor(
      messages,
      [{ id: 's1', persona: 'implementer', task: 'add the button', state: 'done' }] as PlanStep[],
    )
    expect(withPlan[0]).toMatchObject({ state: 'done' })

    // A step from an earlier plan has no state anywhere — showing it as
    // pending would be inventing a fact.
    const without = decisionsFor(messages)
    expect(without[0]).not.toHaveProperty('state')
  })

  it('shows the app pushing back, which is half of why a canvas looks wrong', () => {
    const d = decisionsFor([msg('system', 'Declared single but wrote 4 steps.', { error: true })])
    expect(d).toEqual([
      expect.objectContaining({ kind: 'note', text: 'Declared single but wrote 4 steps.' }),
    ])
  })

  it('counts answering as a decision rather than dropping the turn', () => {
    const d = decisionsFor([msg('assistant', 'Spawn depth is counted per agent.')])
    expect(d[0]).toMatchObject({ kind: 'answer', text: 'Spawn depth is counted per agent.' })
  })

  it('does not mistake a worker reporting back for the user asking', () => {
    const d = decisionsFor(
      [msg('user', '<canvastrator-report from="reviewer">\nreviewer reported:\n\nall clear\n</canvastrator-report>')],
    )
    expect(d).toEqual([])
  })

  it('names a role the orchestrator invented, since that is a decision too', () => {
    const d = decisionsFor(
      [
        msg(
          'assistant',
          '```canvastrator-persona\nname: api-designer\nprovider: claude\npermission: plan\ndescription: Designs HTTP APIs.\n---\nYou design APIs.\n```\nPLAN api-designer: design /sessions',
        ),
      ],
    )
    expect(d.map((x) => x.kind)).toEqual(['persona', 'step'])
    expect(d[0]).toMatchObject({ name: 'api-designer', description: 'Designs HTTP APIs.' })
  })

  it('keeps the protocol lines out of the prose it quotes', () => {
    const d = decisionsFor(
      [msg('assistant', "Here's my reasoning about the auth path.\nPLAN reviewer: read it")],
    )
    expect(d.map((x) => x.kind)).toEqual(['step'])
  })

  it('quotes prose that merely mentions the protocol, rather than eating it', () => {
    const d = decisionsFor([msg('assistant', 'Spawn depth is counted per agent, not per canvas.')])
    expect(d[0]).toMatchObject({ kind: 'answer' })
    expect(d[0]).toHaveProperty('text', 'Spawn depth is counted per agent, not per canvas.')
  })

  it('skips a reply that is still streaming', () => {
    expect(decisionsFor([msg('assistant', 'PATTERN sin', { pending: true })])).toEqual([])
  })
})
