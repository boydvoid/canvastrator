import { describe, expect, it } from 'vitest'
import { choicesFrom } from './choices'

describe('choicesFrom', () => {
  it('reads a numbered list as options', () => {
    const asked = [
      'The fallback has two callers left.',
      '1. Drop it — nothing has called it since the worktree split',
      '2. Keep it — the tauri build still wants a path',
    ].join('\n')
    expect(choicesFrom(asked)).toEqual([
      { label: 'Drop it', note: 'nothing has called it since the worktree split' },
      { label: 'Keep it', note: 'the tauri build still wants a path' },
    ])
  })

  it('reads a bolted lead-in as the label', () => {
    expect(choicesFrom('- **drop it** — dead since the split\n- **keep it** — the build wants it')).toEqual(
      [
        { label: 'drop it', note: 'dead since the split' },
        { label: 'keep it', note: 'the build wants it' },
      ],
    )
  })

  it('takes bullets with no explanation at all', () => {
    expect(choicesFrom('- rebase\n- merge')).toEqual([
      { label: 'rebase', note: null },
      { label: 'merge', note: null },
    ])
  })

  it('refuses a list of one — a single bullet is a note, not a menu', () => {
    expect(choicesFrom('- just the one thing')).toEqual([])
  })

  it('falls back to the alternatives in the question itself', () => {
    expect(choicesFrom('I read both paths.\nShould I drop the fallback or keep it?')).toEqual([
      { label: 'drop the fallback', note: null },
      { label: 'keep it', note: null },
    ])
  })

  it('prefers an enumerated list over splitting the sentence', () => {
    const asked = ['Should I drop it or keep it?', '1. drop it', '2. keep it'].join('\n')
    expect(choicesFrom(asked).map((c) => c.label)).toEqual(['drop it', 'keep it'])
  })

  it('drops items too long to be a button', () => {
    const long = 'a'.repeat(60)
    expect(choicesFrom(`- ${long}\n- ${long}`)).toEqual([])
  })

  it('caps at four, because a fifth button is a menu', () => {
    expect(choicesFrom(['- one', '- two', '- three', '- four', '- five'].join('\n'))).toHaveLength(4)
  })

  it('has nothing to offer for a turn that asked nothing', () => {
    expect(choicesFrom('Done. The suite passes.')).toEqual([])
    expect(choicesFrom('')).toEqual([])
  })
})
