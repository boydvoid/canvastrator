import { describe, expect, it } from 'vitest'
import { MODEL_OPTIONS, modelLabel, type Provider } from './types'

const PROVIDERS: Provider[] = ['claude', 'codex', 'opencode']

describe('the models offered per provider', () => {
  it('names opencode models the way opencode does — provider/model', () => {
    for (const m of MODEL_OPTIONS.opencode) expect(m.id).toMatch(/^[\w-]+\/\S+$/)
  })

  it('keeps the id CLI-shaped — no stray whitespace to pass to --model', () => {
    // Nothing is asserted about the label beyond it being non-empty: a model
    // whose product name is its lowercase id (an `o3`-style one) is legitimate.
    for (const p of PROVIDERS) {
      for (const m of MODEL_OPTIONS[p]) {
        expect(m.id.trim()).toBe(m.id)
        expect(m.label.trim()).not.toBe('')
      }
    }
  })

  it('tiers models with a value the prompt knows, and never a whole list blind', () => {
    // The orchestrator brief groups ids by tier. An unrecognised tier would
    // silently drop a model out of the guidance; a wholly untiered provider
    // would leave the reader ranking ids by list order again.
    for (const p of PROVIDERS) {
      for (const m of MODEL_OPTIONS[p])
        if (m.tier !== undefined) expect(['heavy', 'mid', 'light']).toContain(m.tier)
      expect(MODEL_OPTIONS[p].some((m) => m.tier !== undefined)).toBe(true)
    }
  })

  it('lists each id once per provider', () => {
    for (const p of PROVIDERS) {
      const ids = MODEL_OPTIONS[p].map((m) => m.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('has no empty option list — every provider has something to click', () => {
    for (const p of PROVIDERS) expect(MODEL_OPTIONS[p].length).toBeGreaterThan(0)
  })

  it('falls back to the id for a model it does not know', () => {
    expect(modelLabel('claude', 'some-future-model')).toBe('some-future-model')
  })

  it('falls back rather than throwing for a provider it has no options for', () => {
    // A canvas saved by an older build can name a provider this one dropped.
    const gone = 'retired-provider' as Provider
    expect(modelLabel(gone, 'some-model')).toBe('some-model')
  })

  it('still carries the model the orchestrator brief holds up as its example', () => {
    expect(MODEL_OPTIONS.claude.map((m) => m.id)).toContain('claude-opus-5')
  })
})

/**
 * What a session node's model badge shows. The node itself renders the badge
 * only when a model is pinned, so the unset case never reaches this — what is
 * covered here is everything the badge's text depends on.
 */
describe('the model a running session badges itself with', () => {
  it('shows an id we do not know verbatim, never blank', () => {
    // A persona written against an older id, or one typed by hand.
    expect(modelLabel('claude', 'claude-3-5-sonnet-20241022')).toBe(
      'claude-3-5-sonnet-20241022',
    )
    expect(modelLabel('opencode', 'ollama/llama4')).toBe('ollama/llama4')
  })

  it('never resolves to nothing for any id', () => {
    for (const p of PROVIDERS) {
      for (const id of [...MODEL_OPTIONS[p].map((m) => m.id), 'unheard-of'])
        expect(modelLabel(p, id)).not.toBe('')
    }
  })
})
