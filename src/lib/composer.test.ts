import { describe, expect, it } from 'vitest'
import { activeToken } from '@/components/Composer'

const at = (text: string, caret = text.length) => activeToken(text, caret)

describe('activeToken — slash commands', () => {
  it('opens on a slash at the start of the message', () => {
    expect(at('/')).toMatchObject({ trigger: '/', query: '' })
    expect(at('/rev')).toMatchObject({ trigger: '/', query: 'rev' })
  })

  /** Mid-sentence slashes are paths and dates, not commands. */
  it('ignores a slash inside prose', () => {
    expect(at('look at src/lib')).toBeNull()
    expect(at('due 12/05')).toBeNull()
    expect(at('run the /review thing')).toBeNull()
  })

  it('closes once the token is finished', () => {
    expect(at('/review ')).toBeNull()
    expect(at('/review the diff')).toBeNull()
  })

  it('allows leading whitespace before the slash', () => {
    expect(at('  /rev')).toMatchObject({ trigger: '/', query: 'rev' })
  })
})

describe('activeToken — file mentions', () => {
  it('opens on @ anywhere a word could start', () => {
    expect(at('@')).toMatchObject({ trigger: '@', query: '' })
    expect(at('look at @src/lib')).toMatchObject({ trigger: '@', query: 'src/lib' })
  })

  /** An email address is not a mention. */
  it('ignores @ glued to the end of a word', () => {
    expect(at('mail bobby@example.com')).toBeNull()
    expect(at('foo@bar')).toBeNull()
  })

  it('keeps the token open across slashes in a path', () => {
    expect(at('@src/lib/store.ts')).toMatchObject({ query: 'src/lib/store.ts' })
  })

  it('closes after whitespace', () => {
    expect(at('@src/lib/store.ts and')).toBeNull()
  })
})

describe('activeToken — caret position', () => {
  it('completes the token the caret is inside, not the last one typed', () => {
    const text = '@one @two'
    expect(at(text, 4)).toMatchObject({ query: 'one' })
    expect(at(text, 9)).toMatchObject({ query: 'two' })
  })

  it('is null when the caret sits before any trigger', () => {
    expect(at('hello @file', 3)).toBeNull()
  })

  it('reports where to splice the replacement', () => {
    const t = at('check @sto')
    expect(t?.start).toBe(6)
  })

  it('handles an empty message', () => {
    expect(at('')).toBeNull()
  })
})
