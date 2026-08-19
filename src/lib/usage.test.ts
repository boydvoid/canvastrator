import { describe, expect, it } from 'vitest'
import { band, canvasUsage, contextUse, fmtTokens, fmtUsd, type SessionLike } from './usage'

const session = (over: Partial<SessionLike> = {}): SessionLike => ({
  id: 'n1',
  name: 'orchestrator',
  provider: 'claude',
  model: 'claude-opus-5',
  usage: { costUsd: 0.5, inputTokens: 100, outputTokens: 20 },
  contextTokens: 100_000,
  ...over,
})

describe('contextUse', () => {
  it('divides the last turn by the model window', () => {
    expect(contextUse(session())).toEqual({
      tokens: 100_000,
      limit: 1_000_000,
      fraction: 0.1,
    })
  })

  it('is nothing before a turn has reported — unknown is not empty', () => {
    expect(contextUse(session({ contextTokens: undefined }))).toBeNull()
  })

  it('reports the tokens with no fraction when the window is unknown', () => {
    const use = contextUse(session({ model: undefined }))
    expect(use).toEqual({ tokens: 100_000, limit: null, fraction: null })
  })

  it('knows the one current Claude model still on a smaller window', () => {
    const use = contextUse(session({ model: 'claude-haiku-4-5-20251001', contextTokens: 100_000 }))
    expect(use?.limit).toBe(200_000)
    expect(use?.fraction).toBe(0.5)
  })

  it('never exceeds a full window, however the provider counts', () => {
    expect(contextUse(session({ contextTokens: 2_000_000 }))?.fraction).toBe(1)
  })
})

describe('band', () => {
  it('says nothing until a window is genuinely tight', () => {
    expect(band(0)).toBe('calm')
    expect(band(0.5)).toBe('calm')
    expect(band(0.74)).toBe('calm')
  })

  it('warns where a long task stops fitting, and again where a turn does', () => {
    expect(band(0.75)).toBe('warm')
    expect(band(0.89)).toBe('warm')
    expect(band(0.9)).toBe('hot')
    expect(band(1)).toBe('hot')
  })

  it('is calm about a window it cannot measure, rather than alarmed', () => {
    expect(band(null)).toBe('calm')
  })
})

describe('canvasUsage', () => {
  it('totals the canvas', () => {
    const u = canvasUsage([
      session(),
      session({ id: 'n2', usage: { costUsd: 0.25, inputTokens: 10, outputTokens: 5 } }),
    ])
    expect(u.sessions).toBe(2)
    expect(u.costUsd).toBe(0.75)
    expect(u.inputTokens).toBe(110)
    expect(u.outputTokens).toBe(25)
  })

  it('names the fullest window, since that is what fails first', () => {
    const u = canvasUsage([
      session({ name: 'roomy', contextTokens: 100_000 }),
      session({ id: 'n2', name: 'crowded', contextTokens: 900_000 }),
    ])
    expect(u.tightest?.name).toBe('crowded')
    expect(u.tightest?.use.fraction).toBe(0.9)
  })

  it('ranks by how full, not by how many — an unknown window cannot compete', () => {
    const u = canvasUsage([
      session({ name: 'big-unknown', model: undefined, contextTokens: 900_000 }),
      session({ id: 'n2', name: 'small-but-full', contextTokens: 950_000 }),
    ])
    expect(u.tightest?.name).toBe('small-but-full')
  })

  it('has no tightest when nothing has run', () => {
    expect(canvasUsage([session({ contextTokens: undefined })]).tightest).toBeNull()
    expect(canvasUsage([]).tightest).toBeNull()
  })
})

describe('formatting', () => {
  it('keeps token counts short and stops them flickering', () => {
    expect(fmtTokens(940)).toBe('940')
    expect(fmtTokens(9400)).toBe('9.4k')
    expect(fmtTokens(94_120)).toBe('94k')
    expect(fmtTokens(1_240_000)).toBe('1.24M')
  })

  it('shows money at a precision that suits its size', () => {
    expect(fmtUsd(0)).toBe('$0')
    expect(fmtUsd(0.0004)).toBe('$0.0004')
    expect(fmtUsd(0.512)).toBe('$0.512')
    expect(fmtUsd(12.3456)).toBe('$12.35')
  })
})
