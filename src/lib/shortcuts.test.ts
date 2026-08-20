import { describe, expect, it } from 'vitest'
import { SHORTCUT_LABEL, keyToCanvasAction, keyToDensity, shouldIgnoreShortcut } from './shortcuts'

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
    expect(keyToCanvasAction({ key: 'e' })).toBe('terminal')
    // `p` was left unbound when personality nodes were removed, so that a key
    // with muscle memory behind it would do nothing rather than something
    // else. That was several releases ago and the mnemonic is now free; it is
    // the obvious letter for Pulse, and leaving it dead to protect a habit
    // nobody can still have costs more than it saves.
    expect(keyToCanvasAction({ key: 'p' })).toBe('pulse')
    expect(keyToCanvasAction({ key: 'u' })).toBe('usage')
    // The persona panel takes "l" for the library it shows: "p" is Pulse's.
    expect(keyToCanvasAction({ key: 'l' })).toBe('personas')
    expect(keyToCanvasAction({ key: 't' })).toBe('tidy')
    expect(keyToCanvasAction({ key: 'g' })).toBe('rules')
  })

  it('every action a key can produce has a label for the menu', () => {
    // The menu is the discoverable list and these are the fast path, so a
    // binding with no hint beside it is one nobody finds. Swept rather than
    // listed, so a key added without a label fails here instead of shipping.
    const keys = [...'abcdefghijklmnopqrstuvwxyz', 'Delete', 'Backspace']
    for (const key of keys) {
      const action = keyToCanvasAction({ key })
      if (action) expect(SHORTCUT_LABEL[action]).toBeTruthy()
    }
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

describe('keyToDensity', () => {
  it('reads the digit off the physical key, not off what was typed', () => {
    // ⌥1 on a Mac keyboard produces ¡, so `key` alone cannot be trusted here.
    expect(keyToDensity({ key: '¡', code: 'Digit1', altKey: true })).toBe('glance')
    expect(keyToDensity({ key: '™', code: 'Digit2', altKey: true })).toBe('summary')
    expect(keyToDensity({ key: '£', code: 'Digit3', altKey: true })).toBe('full')
  })

  it('still works where the digit does come through', () => {
    expect(keyToDensity({ key: '1', altKey: true })).toBe('glance')
  })

  it('needs the modifier, and refuses the other modifiers', () => {
    // A bare digit is not a command: a canvas is not a numbered list, and an
    // override you trip by accident is one you then have to find and undo.
    expect(keyToDensity({ key: '1', code: 'Digit1' })).toBeNull()
    expect(keyToDensity({ key: '1', code: 'Digit1', altKey: true, metaKey: true })).toBeNull()
    expect(keyToDensity({ key: '1', code: 'Digit1', altKey: true, ctrlKey: true })).toBeNull()
  })

  it('ignores digits outside the ladder', () => {
    expect(keyToDensity({ key: '4', code: 'Digit4', altKey: true })).toBeNull()
    expect(keyToDensity({ key: 'a', code: 'KeyA', altKey: true })).toBeNull()
  })
})
