import { describe, expect, it } from 'vitest'
import { carryBlock, COMPACT_AT, COMPACT_PROMPT, noteFile, noteName, shouldOffer } from './compact'

describe('shouldOffer', () => {
  it('offers once the window is nearly full', () => {
    expect(shouldOffer(COMPACT_AT)).toBe(true)
    expect(shouldOffer(0.97)).toBe(true)
  })

  it('says nothing below the line', () => {
    expect(shouldOffer(0.5)).toBe(false)
    expect(shouldOffer(0)).toBe(false)
  })

  it('never offers for a window whose size is unknown', () => {
    // An offer to compact a conversation nobody can measure is a guess
    // dressed as advice.
    expect(shouldOffer(null)).toBe(false)
    expect(shouldOffer(undefined)).toBe(false)
  })
})

describe('COMPACT_PROMPT', () => {
  it('asks for the things that actually get lost', () => {
    for (const heading of ['## Goal', '## Decisions', '## State', '## Traps', '## Next']) {
      expect(COMPACT_PROMPT).toContain(heading)
    }
  })
})

describe('carryBlock', () => {
  it('hands the note to the fresh window as the agent\'s own', () => {
    const block = carryBlock('## Goal\nShip the parser.')
    expect(block).toContain('<canvastrator-handover>')
    expect(block).toContain('</canvastrator-handover>')
    expect(block).toContain('Ship the parser.')
    // The next window must not re-litigate what the last one settled.
    expect(block).toContain('already made')
  })

  it('is nothing at all when there is no note', () => {
    expect(carryBlock('   ')).toBe('')
    expect(carryBlock('')).toBe('')
  })
})

describe('noteName', () => {
  const at = Date.parse('2026-08-21T04:15:09.123Z')

  it('sorts by time and says whose note it is', () => {
    expect(noteName('implementer', at)).toBe('2026-08-21_04-15-09_implementer.md')
  })

  it('survives whatever the agent was called', () => {
    expect(noteName('Reviewer 2!', at)).toBe('2026-08-21_04-15-09_reviewer-2.md')
    expect(noteName('', at)).toBe('2026-08-21_04-15-09_agent.md')
  })

  it('gives two notes from one agent different names', () => {
    expect(noteName('a', at)).not.toBe(noteName('a', at + 1000))
  })
})

describe('noteFile', () => {
  it('says who wrote it, when, and about what', () => {
    // The file outlives the canvas that made it.
    const text = noteFile('implementer', Date.parse('2026-08-21T04:15:09Z'), '/repo', '## Goal\nx')
    expect(text).toContain('# Handover — implementer')
    expect(text).toContain('2026-08-21T04:15:09.000Z')
    expect(text).toContain('/repo')
    expect(text).toContain('## Goal')
  })
})
