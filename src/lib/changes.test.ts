import { describe, expect, it } from 'vitest'
import { diffStat, shortPath, statLabel, STAT_BUDGET } from './changes'
import type { DiffBase, FilePeek } from './bridge'

const peek = (text: string, over: Partial<FilePeek> = {}): FilePeek => ({
  text,
  bytes: text.length,
  truncated: false,
  binary: false,
  ...over,
})

const head = (original: string | null, reason: string | null = null): DiffBase => ({
  original,
  reason,
  rel: 'a.ts',
})

const L = (...lines: string[]) => lines.join('\n')

describe('diffStat', () => {
  it('counts lines changed against the committed version', async () => {
    const stat = await diffStat(
      '/repo/a.ts',
      async () => peek(L('one', 'TWO', 'three')),
      async () => head(L('one', 'two', 'three')),
    )
    expect(stat).toMatchObject({ added: 1, removed: 1, reason: null, untracked: false })
  })

  it('counts a pure addition with nothing removed', async () => {
    const stat = await diffStat(
      '/repo/a.ts',
      async () => peek(L('one', 'two', 'three')),
      async () => head(L('one', 'three')),
    )
    expect(stat).toMatchObject({ added: 1, removed: 0 })
  })

  it('treats a file git has never seen as all new, not as an error', async () => {
    const stat = await diffStat(
      '/repo/new.ts',
      async () => peek(L('a', 'b', 'c')),
      async () => head(null, 'untracked'),
    )
    expect(stat).toMatchObject({ added: 3, removed: 0, untracked: true })
  })

  it('refuses to count a truncated read rather than guessing', async () => {
    // Everything past the cut would read as deleted, which is worse than
    // saying nothing.
    const stat = await diffStat(
      '/repo/huge.ts',
      async () => peek('a', { truncated: true }),
      async () => head(L('a', 'b')),
    )
    expect(stat).toMatchObject({ added: 0, removed: 0, reason: 'too large to count' })
  })

  it('says nothing about a binary file', async () => {
    const stat = await diffStat(
      '/repo/logo.png',
      async () => peek('', { binary: true }),
      async () => head(''),
    )
    expect(stat.reason).toBe('binary')
  })

  it('survives a read or a baseline that fails outright', async () => {
    const boom = async () => {
      throw new Error('no')
    }
    expect((await diffStat('/x', boom, async () => head(''))).reason).toBe('could not be read')
    expect((await diffStat('/x', async () => peek('a'), boom)).reason).toBe('no baseline')
  })

  it('reads with a budget big enough that whole files are the normal case', async () => {
    let asked: number | undefined
    await diffStat(
      '/repo/a.ts',
      async (_p, max) => {
        asked = max
        return peek('a')
      },
      async () => head('a'),
    )
    expect(asked).toBe(STAT_BUDGET)
  })

  it('reports an unchanged file as zero rather than as an error', async () => {
    const stat = await diffStat(
      '/repo/a.ts',
      async () => peek(L('one', 'two')),
      async () => head(L('one', 'two')),
    )
    expect(stat).toMatchObject({ added: 0, removed: 0, reason: null })
  })
})

describe('statLabel', () => {
  it('names the counts, or says why there are none', () => {
    expect(statLabel({ path: 'a', added: 4, removed: 1, reason: null, untracked: false })).toBe(
      '+4 −1',
    )
    expect(statLabel({ path: 'a', added: 0, removed: 0, reason: null, untracked: false })).toBe(
      'no change',
    )
    expect(statLabel({ path: 'a', added: 0, removed: 0, reason: 'binary', untracked: false })).toBe(
      'binary',
    )
  })

  it('still shows counts for an untracked file, which has a reason but is fine', () => {
    expect(statLabel({ path: 'a', added: 9, removed: 0, reason: 'untracked', untracked: true })).toBe(
      '+9 −0',
    )
  })
})

describe('shortPath', () => {
  it('drops the root a canvas is working in', () => {
    expect(shortPath('/Users/me/dev/app/src/lib/store.ts', '/Users/me/dev/app')).toBe(
      'src/lib/store.ts',
    )
  })

  it('keeps the tail when the file is outside that root', () => {
    expect(shortPath('/Users/me/other/src/lib/store.ts', '/Users/me/dev/app')).toBe(
      'src/lib/store.ts',
    )
  })

  it('keeps a short path whole', () => {
    expect(shortPath('/tmp/notes.md')).toBe('tmp/notes.md')
  })

  it('does not return an empty string for the root itself', () => {
    // The root has no path inside it, so it falls back to its own tail.
    expect(shortPath('/Users/me/dev/app', '/Users/me/dev/app')).toBe('me/dev/app')
  })
})
