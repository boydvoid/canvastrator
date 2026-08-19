import { describe, expect, it } from 'vitest'
import { parseSpawn } from './store'

describe('parseSpawn', () => {
  it('reads the personality and the task', () => {
    expect(parseSpawn('SPAWN haiku-writer: Write a poem about grids.')).toEqual({
      personality: 'haiku-writer',
      task: 'Write a poem about grids.',
    })
  })

  it('finds the line inside a longer reply', () => {
    const reply = "Sure, I'll hand that to a specialist.\n\nSPAWN reviewer: Check src/lib for unsafe casts\n\nI'll report back."
    expect(parseSpawn(reply)?.personality).toBe('reviewer')
  })

  it('is case-insensitive on the keyword but keeps the name verbatim', () => {
    expect(parseSpawn('spawn Graphics-Designer: make a logo')?.personality).toBe('Graphics-Designer')
  })

  it('ignores prose that merely mentions spawning', () => {
    expect(parseSpawn('I could spawn a worker for this if you like.')).toBeNull()
    expect(parseSpawn('SPAWN without a colon')).toBeNull()
    expect(parseSpawn('')).toBeNull()
  })

  it('requires a task', () => {
    expect(parseSpawn('SPAWN reviewer:')).toBeNull()
    expect(parseSpawn('SPAWN reviewer:   ')).toBeNull()
  })
})

describe('library uniqueness', () => {
  it('keeps one persona per name, last wins', async () => {
    const { dedupeByName } = await import('./library')
    const base = { description: '', provider: 'claude' as const, permission: 'auto' as const, instructions: '' }
    const out = dedupeByName([
      { id: '1', name: 'reviewer', ...base },
      { id: '2', name: 'implementer', ...base },
      { id: '3', name: 'Reviewer', ...base, instructions: 'newer' },
    ])
    expect(out.map((p) => p.name)).toEqual(['Reviewer', 'implementer'])
    expect(out.find((p) => p.name === 'Reviewer')?.instructions).toBe('newer')
  })

  it('leaves a clean library alone', async () => {
    const { dedupeByName, STARTER_PERSONAS } = await import('./library')
    expect(dedupeByName(STARTER_PERSONAS)).toHaveLength(STARTER_PERSONAS.length)
  })
})

describe('the model a persona runs on', () => {
  it('survives the round trip between library and canvas node', async () => {
    const { nodeDataFromPersona, personaFromNode } = await import('./library')
    const persona = {
      id: 'p1',
      name: 'reviewer',
      description: 'reviews',
      provider: 'claude' as const,
      model: 'opus',
      permission: 'plan' as const,
      instructions: 'review things',
    }

    const node = nodeDataFromPersona(persona)
    expect(node.model).toBe('opus')
    expect(personaFromNode({ ...node, personalityId: 'pers_1' }).model).toBe('opus')
  })

  it('leaves the model unset rather than empty, so the CLI picks its own', async () => {
    const { nodeDataFromPersona, personaFromNode } = await import('./library')
    const persona = {
      id: 'p1',
      name: 'reviewer',
      description: 'reviews',
      provider: 'claude' as const,
      permission: 'plan' as const,
      instructions: '',
    }

    const node = nodeDataFromPersona(persona)
    expect('model' in node).toBe(false)
    expect('model' in personaFromNode({ ...node, personalityId: 'pers_1' })).toBe(false)
  })
})

describe('the effort a persona runs at', () => {
  it('survives the round trip between library and canvas node', async () => {
    const { nodeDataFromPersona, personaFromNode } = await import('./library')
    const persona = {
      id: 'p1',
      name: 'architect',
      description: 'designs',
      provider: 'claude' as const,
      effort: 'xhigh' as const,
      permission: 'plan' as const,
      instructions: 'design things',
    }

    const node = nodeDataFromPersona(persona)
    expect(node.effort).toBe('xhigh')
    expect(personaFromNode({ ...node, personalityId: 'pers_1' }).effort).toBe('xhigh')
  })

  it('leaves the effort unset rather than empty, so the CLI picks its own', async () => {
    const { nodeDataFromPersona, personaFromNode } = await import('./library')
    const persona = {
      id: 'p1',
      name: 'architect',
      description: 'designs',
      provider: 'claude' as const,
      permission: 'plan' as const,
      instructions: '',
    }

    const node = nodeDataFromPersona(persona)
    expect('effort' in node).toBe(false)
    expect('effort' in personaFromNode({ ...node, personalityId: 'pers_1' })).toBe(false)
  })
})

describe('parseSpawn — multi-line briefs', () => {
  /** The bug: a line-anchored pattern truncated a careful brief to one line. */
  it('keeps a multi-paragraph task whole', () => {
    const reply = `I'll hand this to a specialist.

SPAWN implementer: Add a summary node to the canvas.

When a session finishes a turn, spawn a node connected to it
containing a short account of what the agent did.

Work in /Users/me/repo.`
    const p = parseSpawn(reply)
    expect(p?.personality).toBe('implementer')
    expect(p?.task).toContain('Add a summary node')
    expect(p?.task).toContain('short account of what the agent did')
    expect(p?.task).toContain('Work in /Users/me/repo.')
  })

  it('stops at the next SPAWN rather than swallowing it', () => {
    const reply = 'SPAWN a: first task\nmore of the first\nSPAWN b: second task'
    const p = parseSpawn(reply)
    expect(p?.personality).toBe('a')
    expect(p?.task).toBe('first task\nmore of the first')
    expect(p?.task).not.toContain('second task')
  })

  it('stops at a following DELEGATE line', () => {
    const p = parseSpawn('SPAWN a: do the thing\nDELEGATE worker: something else')
    expect(p?.task).toBe('do the thing')
  })

  it('still rejects an empty task', () => {
    expect(parseSpawn('SPAWN reviewer:')).toBeNull()
    expect(parseSpawn('SPAWN reviewer:   ')).toBeNull()
  })

  it('still ignores prose that mentions spawning', () => {
    expect(parseSpawn('I could spawn a worker for this.')).toBeNull()
  })
})
