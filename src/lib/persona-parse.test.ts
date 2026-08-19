import { describe, expect, it } from 'vitest'
import { parsePersonaDefinitions } from './persona-parse'

const block = `Here's what I'd use.

\`\`\`canvastrator-persona
name: api-designer
provider: claude
model: opus
effort: high
permission: plan
description: Designs HTTP APIs and data contracts.
---
You design APIs. Produce the contract and the reasoning.
Do not write implementation code.
\`\`\`

SPAWN api-designer: Design the /sessions endpoint`

describe('parsePersonaDefinitions', () => {
  it('reads every field, including the model suggestion', () => {
    const [p] = parsePersonaDefinitions(block)
    expect(p.name).toBe('api-designer')
    expect(p.provider).toBe('claude')
    expect(p.model).toBe('opus')
    expect(p.effort).toBe('high')
    expect(p.permission).toBe('plan')
    expect(p.description).toBe('Designs HTTP APIs and data contracts.')
  })

  it('keeps the brief as multi-line text', () => {
    const [p] = parsePersonaDefinitions(block)
    expect(p.instructions).toContain('You design APIs')
    expect(p.instructions).toContain('Do not write implementation code.')
    expect(p.instructions).not.toContain('---')
    expect(p.instructions).not.toContain('description:')
  })

  it('reads several definitions from one reply', () => {
    const two = `${block}\n\n\`\`\`canvastrator-persona\nname: b\ndescription: second\n---\nbrief\n\`\`\``
    expect(parsePersonaDefinitions(two).map((p) => p.name)).toEqual(['api-designer', 'b'])
  })

  it('falls back to safe defaults for a missing or bogus provider or permission', () => {
    const [p] = parsePersonaDefinitions(
      '```canvastrator-persona\nname: x\nprovider: gpt9\npermission: root\ndescription: d\n---\nb\n```',
    )
    expect(p.provider).toBe('claude')
    expect(p.permission).toBe('auto')
    expect(p.model).toBeUndefined()
  })

  /** An effort we don't recognise must mean "the CLI's default", not a level
   *  we invented on the orchestrator's behalf. */
  it('accepts any case of a known effort and drops an unknown one', () => {
    const ok = parsePersonaDefinitions(
      '```canvastrator-persona\nname: x\neffort: XHigh\ndescription: d\n---\nb\n```',
    )
    expect(ok[0].effort).toBe('xhigh')

    const bad = parsePersonaDefinitions(
      '```canvastrator-persona\nname: x\neffort: ludicrous\ndescription: d\n---\nb\n```',
    )
    expect(bad[0].effort).toBeUndefined()
  })

  /** Both are load-bearing: no name means nothing to SPAWN, no description
   *  means a future orchestrator can't tell whether it fits. */
  it('rejects a definition missing a name or a description', () => {
    expect(parsePersonaDefinitions('```canvastrator-persona\nprovider: claude\n---\nb\n```')).toEqual([])
    expect(parsePersonaDefinitions('```canvastrator-persona\nname: x\n---\nb\n```')).toEqual([])
  })

  it('ignores prose that merely talks about personas', () => {
    expect(parsePersonaDefinitions('I could define a persona for this.')).toEqual([])
    expect(parsePersonaDefinitions('```ts\nconst name = "x"\n```')).toEqual([])
  })
})
