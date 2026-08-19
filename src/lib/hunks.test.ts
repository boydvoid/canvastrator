import { describe, expect, it } from 'vitest'
import { computeHunks, describeHunk, hunkRange, revertHunk } from './hunks'

const L = (...lines: string[]) => lines.join('\n')

describe('computeHunks', () => {
  it('finds nothing in identical text', () => {
    expect(computeHunks(L('a', 'b'), L('a', 'b'))).toEqual([])
    expect(computeHunks('', '')).toEqual([])
  })

  it('finds a single changed line', () => {
    const h = computeHunks(L('a', 'b', 'c'), L('a', 'X', 'c'))
    expect(h).toHaveLength(1)
    expect(h[0].originalLines).toEqual(['b'])
    expect(h[0].modifiedLines).toEqual(['X'])
  })

  it('separates changes that have untouched lines between them', () => {
    const h = computeHunks(L('a', 'b', 'c', 'd', 'e'), L('a', 'B', 'c', 'D', 'e'))
    expect(h).toHaveLength(2)
    expect(h[0].modifiedLines).toEqual(['B'])
    expect(h[1].modifiedLines).toEqual(['D'])
  })

  it('reports a pure addition and a pure removal', () => {
    expect(describeHunk(computeHunks(L('a', 'c'), L('a', 'b', 'c'))[0])).toBe('added')
    expect(describeHunk(computeHunks(L('a', 'b', 'c'), L('a', 'c'))[0])).toBe('removed')
  })

  it('handles a file created from nothing', () => {
    const h = computeHunks('', L('one', 'two'))
    expect(h).toHaveLength(1)
    expect(h[0].modifiedLines).toEqual(['one', 'two'])
    expect(describeHunk(h[0])).toBe('added')
  })

  it('handles a file emptied entirely', () => {
    expect(describeHunk(computeHunks(L('one', 'two'), '')[0])).toBe('removed')
  })

  it('catches a change at the very end', () => {
    const h = computeHunks(L('a', 'b'), L('a', 'b', 'c'))
    expect(h).toHaveLength(1)
    expect(h[0].modifiedLines).toEqual(['c'])
  })
})

describe('revertHunk', () => {
  const original = L('one', 'two', 'three', 'four', 'five')
  const modified = L('one', 'TWO', 'three', 'FOUR', 'five')

  /** The whole point: take back one change and keep the others. */
  it('reverts one change and leaves the rest', () => {
    expect(revertHunk(original, modified, 0)).toBe(L('one', 'two', 'three', 'FOUR', 'five'))
  })

  it('reverts the second change independently', () => {
    expect(revertHunk(original, modified, 1)).toBe(L('one', 'TWO', 'three', 'four', 'five'))
  })

  /**
   * Reverting shifts line numbers, so a second revert has to be computed
   * against the text as it now stands, not against remembered positions.
   */
  it('reverting every hunk in turn restores the original', () => {
    let text = modified
    for (let guard = 0; guard < 10; guard++) {
      if (!computeHunks(original, text).length) break
      text = revertHunk(original, text, 0)
    }
    expect(text).toBe(original)
  })

  it('survives reverting a hunk that no longer exists', () => {
    expect(revertHunk(original, original, 0)).toBe(original)
    expect(revertHunk(original, modified, 99)).toBe(modified)
  })

  it('reverts an addition by removing the added lines', () => {
    expect(revertHunk(L('a', 'c'), L('a', 'b', 'c'), 0)).toBe(L('a', 'c'))
  })

  it('reverts a removal by putting the lines back', () => {
    expect(revertHunk(L('a', 'b', 'c'), L('a', 'c'), 0)).toBe(L('a', 'b', 'c'))
  })
})

describe('hunkRange', () => {
  it('names a single line, a span, and an insertion point', () => {
    expect(hunkRange(computeHunks(L('a', 'b'), L('a', 'X'))[0])).toBe('line 2')
    expect(hunkRange(computeHunks(L('a', 'b', 'c'), L('a', 'X', 'Y'))[0])).toBe('lines 2–3')
    expect(hunkRange(computeHunks(L('a', 'b'), L('a'))[0])).toBe('after line 1')
  })
})
