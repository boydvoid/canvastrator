import { describe, expect, it } from 'vitest'
import { bareName, grouped, search, shelf } from './skills'
import type { DiscoveredSkill } from './types'

const found = (over: Partial<DiscoveredSkill> = {}): DiscoveredSkill => ({
  name: 'stripe-docs',
  description: 'Read Stripe documentation',
  provider: 'claude',
  source: 'stripe',
  kind: 'skill',
  path: '/plugins/stripe/skills/stripe-docs/SKILL.md',
  ...over,
})

describe('bareName', () => {
  it('drops the namespace a command is invoked under', () => {
    expect(bareName('stripe:test-cards')).toBe('test-cards')
    expect(bareName('wt')).toBe('wt')
  })
})

describe('shelf', () => {
  it('lists what is installed, and marks what a session actually loaded', () => {
    const rows = shelf(
      [found(), found({ name: 'dataviz', source: 'user' })],
      [],
      [{ skills: ['dataviz'], commands: [] }],
    )
    expect(rows.map((r) => [r.name, r.origin, r.loaded])).toEqual([
      ['dataviz', 'user', true],
      ['stripe-docs', 'plugin', false],
    ])
  })

  it('keeps the built-ins, which exist nowhere on disk', () => {
    // The CLI's own skills are inside its binary: the live list is the only
    // place they are ever named, and a shelf without them is missing most of
    // what the agent can do.
    const rows = shelf([], [], [{ skills: ['code-review'], commands: ['init'] }])
    expect(rows.map((r) => r.name).sort()).toEqual(['code-review', 'init'])
    expect(rows.every((r) => r.origin === 'built-in' && r.loaded)).toBe(true)
  })

  it('matches a namespaced skill against the bare name a session reports', () => {
    const rows = shelf([found({ name: 'stripe:test-cards', kind: 'command' })], [], [
      { skills: [], commands: ['test-cards'] },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].loaded).toBe(true)
  })

  it('lets a canvas skill win over an installed one of the same name', () => {
    const rows = shelf(
      [found({ name: 'house-style', source: 'user' })],
      [{ id: 'n1', name: 'house-style', description: 'written here' }],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].origin).toBe('canvas')
    expect(rows[0].nodeId).toBe('n1')
  })

  it('puts what you are working on first and unused plugins last', () => {
    const rows = shelf(
      [found(), found({ name: 'mine', source: 'user' })],
      [{ id: 'n1', name: 'ours', description: '' }],
      [{ skills: ['built'], commands: [] }],
    )
    expect(rows.map((r) => r.origin)).toEqual(['canvas', 'user', 'built-in', 'plugin'])
  })
})

describe('search', () => {
  const rows = shelf([found(), found({ name: 'dataviz', description: 'Charts' })], [], [])

  it('matches name and description, and nothing looser', () => {
    expect(search(rows, 'stripe').map((r) => r.name)).toEqual(['stripe-docs'])
    expect(search(rows, 'charts').map((r) => r.name)).toEqual(['dataviz'])
    expect(search(rows, 'zzz')).toEqual([])
  })

  it('returns everything for an empty query', () => {
    expect(search(rows, '  ')).toHaveLength(2)
  })
})

describe('grouped', () => {
  it('gives every plugin its own heading', () => {
    const rows = shelf(
      [found(), found({ name: 'frontend-design', source: 'frontend-design' })],
      [],
      [],
    )
    expect(grouped(rows).map((g) => g.label)).toEqual([
      'plugin · frontend-design',
      'plugin · stripe',
    ])
  })

  it('has no empty groups', () => {
    expect(grouped([])).toEqual([])
  })
})
