import { describe, expect, it } from 'vitest'
import { splitAgentText } from './patternline'

/** The kinds in order — the shape of a reply, without the text. */
const kinds = (text: string) => splitAgentText(text).map((s) => s.kind)

describe('splitAgentText', () => {
  it('leaves a reply with no directives as one piece of prose', () => {
    const segs = splitAgentText('The tests pass. Nothing else needed changing.')
    expect(segs).toEqual([
      { kind: 'text', text: 'The tests pass. Nothing else needed changing.' },
    ])
  })

  it('lifts a PATTERN line out of the prose it opens', () => {
    const segs = splitAgentText(
      'PATTERN single: one specialist can read the panel code end to end.\n\nHere is what I found.',
    )
    expect(segs).toEqual([
      {
        kind: 'pattern',
        id: 'single',
        label: 'single-agent loop',
        why: 'one specialist can read the panel code end to end.',
      },
      { kind: 'text', text: 'Here is what I found.' },
    ])
  })

  it('reads a PATTERN and the SPAWN beneath it', () => {
    const segs = splitAgentText(
      [
        'PATTERN parallel: the three files do not read each other.',
        'SPAWN implementer: Convert the panels.',
        '',
        'Second paragraph of the same task.',
      ].join('\n'),
    )
    expect(segs).toEqual([
      {
        kind: 'pattern',
        id: 'parallel',
        label: 'parallelisation',
        why: 'the three files do not read each other.',
      },
      {
        kind: 'spawn',
        name: 'implementer',
        // The task runs to the end of the reply, exactly as the child receives it.
        task: 'Convert the panels.\n\nSecond paragraph of the same task.',
      },
    ])
  })

  it('leaves an unknown pattern id as prose rather than inventing a badge', () => {
    // `swarm` is not one of the six. Badging it would show the user a shape
    // the app never ran the plan under.
    const text = 'PATTERN swarm: everyone at once.\n\nAnyway, here goes.'
    expect(kinds(text)).toEqual(['text'])
    expect(splitAgentText(text)[0]).toEqual({ kind: 'text', text })
  })

  it('accepts the spellings the models actually write', () => {
    // The literature's names, not this app's short ids.
    const segs = splitAgentText('PATTERN orchestrator-worker: the subtasks are not knowable yet.')
    expect(segs).toEqual([
      {
        kind: 'pattern',
        id: 'orchestrate',
        label: 'orchestrator-worker',
        why: 'the subtasks are not knowable yet.',
      },
    ])
  })

  it('ignores PATTERN and SPAWN in the middle of a sentence', () => {
    // Prose about the protocol is not the protocol.
    const text =
      'Anything you can answer yourself, answer — do not write a SPAWN for it, and the PATTERN single: form only counts at the start of a line.'
    expect(kinds(text)).toEqual(['text'])
    expect(splitAgentText(text)[0]).toEqual({ kind: 'text', text })
  })

  it('needs a rationale before it will call a line a shape', () => {
    // The label without the argument is half a decision.
    expect(kinds('PATTERN single:')).toEqual(['text'])
  })

  it('badges only the first shape, matching what the store acts on', () => {
    const segs = splitAgentText(
      'PATTERN single: one agent holds this.\n\nOn reflection:\n\nPATTERN parallel: no, three.',
    )
    expect(segs.map((s) => s.kind)).toEqual(['pattern', 'text'])
    expect(segs[1]).toMatchObject({
      kind: 'text',
      text: expect.stringContaining('PATTERN parallel: no, three.'),
    })
  })

  it('keeps a PATTERN line inside a spawn task with the task', () => {
    // That text is part of the brief the child was sent, not a decision this
    // orchestrator made.
    const segs = splitAgentText(
      'SPAWN planner: Open your reply with\nPATTERN single: why this shape.',
    )
    expect(segs).toEqual([
      {
        kind: 'spawn',
        name: 'planner',
        task: 'Open your reply with\nPATTERN single: why this shape.',
      },
    ])
  })

  it('still splits persona fences and DELEGATE lines', () => {
    const segs = splitAgentText(
      [
        'Making a role for this.',
        '```canvastrator-persona',
        'name: auditor',
        'description: reads diffs',
        '---',
        'You audit changes.',
        '```',
        'DELEGATE auditor: Check the diff.',
      ].join('\n'),
    )
    expect(segs.map((s) => s.kind)).toEqual(['text', 'persona', 'spawn'])
    expect(segs[1]).toMatchObject({ kind: 'persona', name: 'auditor', brief: 'You audit changes.' })
    expect(segs[2]).toMatchObject({ kind: 'spawn', name: 'auditor', task: 'Check the diff.' })
  })
})
