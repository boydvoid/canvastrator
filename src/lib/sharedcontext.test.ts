import { describe, expect, it } from 'vitest'
import { board, freshFor, readCount, search } from './sharedcontext'
import type { ContextEntry } from './types'

const entry = (over: Partial<ContextEntry> = {}): ContextEntry => ({
  id: 'e1',
  sessionId: 's_a',
  sessionName: 'implementer',
  kind: 'summary',
  body: 'the migration renamed the column',
  ts: 1,
  ...over,
})

describe('freshFor', () => {
  const bus = [entry({ id: 'e1' }), entry({ id: 'e2', sessionId: 's_b', sessionName: 'reviewer' })]

  it('gives an agent everything on the board, wired to it or not', () => {
    // Nothing connects these two agents. That is the point: sharing must not
    // depend on somebody having remembered to draw a line.
    expect(freshFor(bus, new Set(), 's_c').map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('never hands an agent its own entry back', () => {
    expect(freshFor(bus, new Set(), 's_a').map((e) => e.id)).toEqual(['e2'])
  })

  it('skips what it has already been given', () => {
    expect(freshFor(bus, new Set(['e1']), 's_c').map((e) => e.id)).toEqual(['e2'])
  })

  it('keeps the order things happened in', () => {
    const older = entry({ id: 'old', ts: 1, sessionId: 's_x' })
    const newer = entry({ id: 'new', ts: 2, sessionId: 's_y' })
    expect(freshFor([older, newer], new Set(), 's_c').map((e) => e.id)).toEqual(['old', 'new'])
  })

  it('is empty when the board is', () => {
    expect(freshFor([], new Set(), 's_a')).toEqual([])
  })
})

describe('readCount', () => {
  const sessions = [{ sessionId: 's_a' }, { sessionId: 's_b' }, { sessionId: 's_c' }]

  it('counts everyone but the author, who never needed telling', () => {
    const got = readCount(entry(), sessions, { s_b: new Set(['e1']) })
    expect(got).toEqual({ read: 1, of: 2 })
  })

  it('is zero of zero on a canvas with only its author', () => {
    expect(readCount(entry(), [{ sessionId: 's_a' }], {})).toEqual({ read: 0, of: 0 })
  })

  it('counts a note from you against every agent', () => {
    // A note nobody authored as an agent is owed to all of them.
    const note = entry({ id: 'n1', sessionId: 'user', sessionName: 'you', kind: 'user' })
    expect(readCount(note, sessions, { s_a: new Set(['n1']) })).toEqual({ read: 1, of: 3 })
  })
})

describe('board', () => {
  it('reads newest first, which is not how it is delivered', () => {
    const bus = [entry({ id: 'a', ts: 1 }), entry({ id: 'b', ts: 2 })]
    expect(board(bus).map((e) => e.id)).toEqual(['b', 'a'])
    // The bus itself is untouched: delivery order is oldest first.
    expect(bus.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('search', () => {
  const entries = [
    entry({ id: 'a', body: 'renamed the column' }),
    entry({ id: 'b', body: 'tests still fail', sessionName: 'reviewer' }),
  ]

  it('matches the note and who wrote it', () => {
    expect(search(entries, 'column').map((e) => e.id)).toEqual(['a'])
    expect(search(entries, 'reviewer').map((e) => e.id)).toEqual(['b'])
  })

  it('returns everything for an empty query', () => {
    expect(search(entries, '  ')).toHaveLength(2)
  })
})
