import { describe, expect, it } from 'vitest'
import { choreBlock, looksLikeChore } from './chore'

describe('looksLikeChore', () => {
  it('takes the operations that are never a project', () => {
    for (const t of [
      'push code',
      'push the branch',
      'commit and push',
      'deploy',
      'rebase onto main',
      'rebuild the app',
      'restart the dev server',
      'revert that last commit',
    ]) {
      expect(looksLikeChore(t), t).toBe(true)
    }
  })

  it('sees through politeness, which is how people actually ask', () => {
    for (const t of ['please push', 'ok now push the branch', 'can you just commit this', "let's deploy"]) {
      expect(looksLikeChore(t), t).toBe(true)
    }
  })

  it('settles the ambiguous verbs by their object, not by the verb', () => {
    expect(looksLikeChore('run the tests')).toBe(true)
    expect(looksLikeChore('build the app')).toBe(true)
    // The same verbs on product work, which is the reason they are not in the
    // bare verb list at all.
    expect(looksLikeChore('build the settings page')).toBe(false)
    expect(looksLikeChore('run a comparison of the two approaches')).toBe(false)
  })

  it('is not fooled by a chore with a real job attached to it', () => {
    expect(looksLikeChore('push the branch and fix whatever CI says')).toBe(false)
    expect(looksLikeChore('commit this, then review the diff for bugs')).toBe(false)
  })

  it('leaves questions alone, even questions about commands', () => {
    expect(looksLikeChore('why did the push fail?')).toBe(false)
    expect(looksLikeChore('should we deploy today?')).toBe(false)
  })

  it('refuses anything long enough to be a brief', () => {
    expect(looksLikeChore('deploy ' + 'x'.repeat(200))).toBe(false)
    expect(looksLikeChore('push\nthen\nsomething\nelse')).toBe(false)
  })

  it('leaves ordinary work to the ladder', () => {
    for (const t of [
      'add a keyboard shortcut for planning mode',
      'the context meter is showing the wrong number',
      'write release notes for this branch',
      '',
    ]) {
      expect(looksLikeChore(t), t).toBe(false)
    }
  })
})

describe('choreBlock', () => {
  it('speaks the protocol of the mode it is in', () => {
    expect(choreBlock(true)).toContain('PLAN step')
    expect(choreBlock(false)).toContain('SPAWN step')
  })

  it('rules out the follow-on work that is the actual complaint', () => {
    const b = choreBlock(true)
    expect(b).toContain('one agent')
    expect(b).toMatch(/do not add a check, a review/)
    expect(b).toMatch(/anything you noticed earlier/)
  })
})
