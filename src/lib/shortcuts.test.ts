import { describe, expect, it } from 'vitest'
import { SHORTCUT_LABEL, keyToCanvasAction, shouldIgnoreShortcut } from './shortcuts'

const el = (over: Partial<Record<string, unknown>> = {}) => ({
  tagName: 'DIV',
  isContentEditable: false,
  closest: () => null,
  ...over,
})

describe('keyToCanvasAction', () => {
  it('maps the bound keys', () => {
    expect(keyToCanvasAction({ key: 's' })).toBe('session')
    expect(keyToCanvasAction({ key: 'f' })).toBe('folder')
    expect(keyToCanvasAction({ key: 'd' })).toBe('file')
    expect(keyToCanvasAction({ key: 'k' })).toBe('skill')
    // `p` is deliberately unbound: personality nodes are gone, and a key that
    // silently does nothing is better than one rebound under the user's hands.
    expect(keyToCanvasAction({ key: 'p' })).toBeNull()
    expect(keyToCanvasAction({ key: 't' })).toBe('tidy')
    expect(keyToCanvasAction({ key: 'g' })).toBe('rules')
  })

  it('deletes on both Delete and Backspace', () => {
    expect(keyToCanvasAction({ key: 'Delete' })).toBe('delete')
    expect(keyToCanvasAction({ key: 'Backspace' })).toBe('delete')
  })

  it('ignores case, so shift-held keys still fire', () => {
    expect(keyToCanvasAction({ key: 'S' })).toBe('session')
  })

  it('leaves modified keys alone — those are the ⌘ shortcuts', () => {
    expect(keyToCanvasAction({ key: 's', metaKey: true })).toBeNull()
    expect(keyToCanvasAction({ key: 's', ctrlKey: true })).toBeNull()
    expect(keyToCanvasAction({ key: 'f', altKey: true })).toBeNull()
  })

  it('returns null for unbound keys', () => {
    expect(keyToCanvasAction({ key: 'z' })).toBeNull()
    expect(keyToCanvasAction({ key: 'Enter' })).toBeNull()
    expect(keyToCanvasAction({ key: ' ' })).toBeNull()
  })

  it('has a label for every action it maps', () => {
    for (const key of ['s', 'f', 'd', 'k', 't', 'g', 'Delete']) {
      const action = keyToCanvasAction({ key })!
      expect(SHORTCUT_LABEL[action]).toBeTruthy()
    }
  })
})

describe('shouldIgnoreShortcut', () => {
  it('lets a plain canvas target through', () => {
    expect(shouldIgnoreShortcut(el())).toBe(false)
    expect(shouldIgnoreShortcut(null)).toBe(false)
  })

  it('ignores text-entry elements', () => {
    expect(shouldIgnoreShortcut(el({ tagName: 'INPUT' }))).toBe(true)
    expect(shouldIgnoreShortcut(el({ tagName: 'textarea' }))).toBe(true)
    expect(shouldIgnoreShortcut(el({ tagName: 'SELECT' }))).toBe(true)
    expect(shouldIgnoreShortcut(el({ isContentEditable: true }))).toBe(true)
  })

  it('ignores anything inside an off-limits container', () => {
    const inside = el({ closest: (sel: string) => (sel.includes('data-shortcuts') ? {} : null) })
    expect(shouldIgnoreShortcut(inside)).toBe(true)
  })

  it('survives a target with no closest (a document or window)', () => {
    expect(shouldIgnoreShortcut({ tagName: undefined })).toBe(false)
  })
})
