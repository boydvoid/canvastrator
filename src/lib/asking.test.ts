import { describe, expect, it } from 'vitest'
import { looksLikeQuestion } from './asking'

describe('looksLikeQuestion', () => {
  it('catches a plain question at the end', () => {
    expect(looksLikeQuestion('I found two approaches. Which should I take?')).toBe(true)
  })

  it('catches an ask that has no question mark', () => {
    expect(looksLikeQuestion('I can do either. Let me know which you prefer.')).toBe(true)
    expect(looksLikeQuestion('Should I also update the tests.')).toBe(true)
    expect(looksLikeQuestion('Waiting on your call before I touch the schema.')).toBe(true)
  })

  it('ignores a finished report', () => {
    expect(looksLikeQuestion('Done. Added the parser and 6 tests, all passing.')).toBe(false)
    expect(looksLikeQuestion('')).toBe(false)
  })

  /** A question asked and then answered in the same turn isn't waiting. */
  it('only looks at the tail', () => {
    const reply = 'Should I use a map here? Yes — a map is right, so I used one.\n\nDone.'
    expect(looksLikeQuestion(reply)).toBe(false)
  })

  it('is not fooled by a question mark inside code', () => {
    expect(looksLikeQuestion('Fixed the regex to `\\\\d+?`')).toBe(false)
  })

  it('reads through a trailing blank line', () => {
    expect(looksLikeQuestion('Which folder should I use?\n\n')).toBe(true)
  })
})
