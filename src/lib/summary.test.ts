import { describe, expect, it } from 'vitest'
import { headlineOf, summarizeTurn } from './summary'

describe('headlineOf', () => {
  it('takes the first paragraph of the reply', () => {
    const reply = 'Added the summary node and wired it up.\n\nIt also needed an edge type.'
    expect(headlineOf(reply)).toBe('Added the summary node and wired it up.')
  })

  it('strips markdown down to the sentence underneath', () => {
    expect(headlineOf('## Done\n\n- Fixed `resolveCwd` and **its** test')).toBe('Done')
    expect(headlineOf('- Fixed `resolveCwd` and **its** test')).toBe('Fixed resolveCwd and its test')
    expect(headlineOf('See [the docs](https://example.com) for why')).toBe('See the docs for why')
  })

  it('skips a reply that opens with a code fence', () => {
    const reply = '```ts\nconst x = 1\n```\n\nBumped the version constant.'
    expect(headlineOf(reply)).toBe('Bumped the version constant.')
  })

  it('ignores an unterminated fence rather than reading its contents', () => {
    expect(headlineOf('Here it is:\n\n```ts\nconst x = 1')).toBe('Here it is:')
  })

  it('skips SPAWN and DELEGATE lines, which are orders rather than an account', () => {
    const reply = 'SPAWN reviewer: Check src/lib for unsafe casts\n\nRouting this to a specialist.'
    expect(headlineOf(reply)).toBe('Routing this to a specialist.')
    expect(headlineOf('DELEGATE tester: run the suite')).toBe('')
  })

  it('skips the PATTERN line, which is a decision rather than an account', () => {
    // The chat lifts this line into a badge; a node that headlines with it is
    // the same control line showing through as prose.
    expect(
      headlineOf('PATTERN single: one specialist holds this.\n\nThe tests pass.'),
    ).toBe('The tests pass.')
  })

  it('keeps a PATTERN line whose id is not one of the six', () => {
    // Same rule as the badge: an id nothing recognises is not a directive, so
    // it stays the visibly-wrong text the model actually wrote.
    expect(headlineOf('PATTERN swarm: everyone at once.\n\nThe tests pass.')).toBe(
      'PATTERN swarm: everyone at once.',
    )
  })

  it('cuts a long reply on a sentence boundary', () => {
    const head = `${'Traced the persona pipeline end to end. '.repeat(5)}Then wrote it up.`
    const out = headlineOf(head)
    expect(out.length).toBeLessThanOrEqual(220)
    expect(out.endsWith('.')).toBe(true)
  })

  it('falls back to a word boundary when there is no sentence to cut on', () => {
    const out = headlineOf('word '.repeat(80).trim())
    expect(out.length).toBeLessThanOrEqual(221)
    expect(out.endsWith('…')).toBe(true)
  })

  it('has nothing to say about an empty reply', () => {
    expect(headlineOf('')).toBe('')
    expect(headlineOf('```\njust code\n```')).toBe('')
  })
})

describe('summarizeTurn', () => {
  it('reports the tools it used, deduplicated and in first-use order', () => {
    const out = summarizeTurn({
      text: 'Ran the build.',
      tools: [
        { name: 'Read', detail: 'store.ts' },
        { name: 'Edit', detail: 'store.ts' },
        { name: 'Read', detail: 'types.ts' },
      ],
    })
    expect(out).toEqual({ headline: 'Ran the build.', tools: ['Read', 'Edit'], toolCount: 3 })
  })

  it('caps the tool list but keeps the true count', () => {
    const tools = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, detail: '' }))
    const out = summarizeTurn({ text: 'Did a lot.', tools })
    expect(out.tools).toEqual(['a', 'b', 'c', 'd'])
    expect(out.toolCount).toBe(6)
  })

  it('leaves an empty headline when the turn said nothing quotable', () => {
    expect(summarizeTurn({ text: '', tools: [] }).headline).toBe('')
  })
})
