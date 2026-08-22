import { describe, expect, it } from 'vitest'
import {
  BELL_KINDS,
  checkTone,
  elapsed,
  isBellKind,
  KIND_LABEL,
  KIND_TONE,
  nowSentence,
  pulseNow,
  runSince,
  stateBar,
  toneColor,
  type CountableSession,
} from './pulse'
import type { Notification, NotificationKind } from './types'

const s = (over: Partial<CountableSession>): CountableSession => ({
  state: 'idle',
  ran: false,
  ...over,
})

describe('pulseNow', () => {
  it('counts each agent exactly once, by the state that outranks', () => {
    const now = pulseNow([
      s({ state: 'streaming' }),
      s({ state: 'thinking' }),
      s({ state: 'error' }),
      s({ awaitingUser: true, ran: true }),
      s({ ran: true }),
    ])
    expect(now).toEqual({ working: 2, needsYou: 1, landed: 1, failed: 1 })
  })

  it('does not count an agent that has never run as landed', () => {
    // Unused is not an outcome; counting it would make every fresh canvas
    // claim results it has not produced.
    expect(pulseNow([s({}), s({})])).toEqual({ working: 0, needsYou: 0, landed: 0, failed: 0 })
  })

  it('reports a working agent as working even if it is also awaiting', () => {
    expect(pulseNow([s({ state: 'thinking', awaitingUser: true })]).working).toBe(1)
    expect(pulseNow([s({ state: 'thinking', awaitingUser: true })]).needsYou).toBe(0)
  })
})

describe('nowSentence', () => {
  it('names only what there is, in a fixed order', () => {
    expect(nowSentence({ working: 3, needsYou: 1, landed: 2, failed: 0 })).toBe(
      '3 working · 1 needs you · 2 landed',
    )
    expect(nowSentence({ working: 0, needsYou: 0, landed: 4, failed: 0 })).toBe('4 landed')
  })

  it('says so when nothing is happening', () => {
    expect(nowSentence({ working: 0, needsYou: 0, landed: 0, failed: 0 })).toBe('nothing running')
  })
})

describe('stateBar', () => {
  it('is absent rather than empty on an idle canvas', () => {
    // A grey rule with nothing in it reads as a loading state.
    expect(stateBar({ working: 0, needsYou: 0, landed: 0, failed: 0 })).toBeNull()
  })

  it('gives every state its own segment and sums to one', () => {
    const bar = stateBar({ working: 1, needsYou: 1, landed: 2, failed: 1 })!
    expect(bar).toHaveLength(4)
    expect(bar.reduce((a, seg) => a + seg.fraction, 0)).toBeCloseTo(1)
    // A question is not a failure: they are drawn apart because one wants an
    // answer and the other wants a rerun.
    expect(bar.find((seg) => seg.tone === 'attn')?.fraction).toBeCloseTo(0.2)
    expect(bar.find((seg) => seg.tone === 'danger')?.fraction).toBeCloseTo(0.2)
  })

  it('drops segments with nothing in them', () => {
    const bar = stateBar({ working: 2, needsYou: 0, landed: 0, failed: 0 })!
    expect(bar).toEqual([{ tone: 'work', fraction: 1 }])
  })
})

describe('elapsed', () => {
  const now = 1_000_000_000

  it('counts seconds for the first minute', () => {
    expect(elapsed(now - 4_000, now)).toBe('4s')
    expect(elapsed(now - 59_000, now)).toBe('59s')
  })

  it('pads the seconds once it is counting minutes', () => {
    expect(elapsed(now - 64_000, now)).toBe('1m04')
    expect(elapsed(now - 3_599_000, now)).toBe('59m59')
  })

  it('goes to hours, then to whole days', () => {
    expect(elapsed(now - 3_660_000, now)).toBe('1h01')
    expect(elapsed(now - 2 * 86_400_000, now)).toBe('2d')
  })

  it('never counts backwards from a clock that jumped', () => {
    expect(elapsed(now + 5_000, now)).toBe('0s')
  })
})

describe('the bell is a filtered view of the same log', () => {
  it('admits outcomes and not the things you did yourself', () => {
    expect(BELL_KINDS).toEqual(['turn', 'question', 'error'])
    expect(isBellKind('question')).toBe(true)
    // A badge asking you to acknowledge your own prompt never clears for a
    // reason anyone wants.
    expect(isBellKind('prompt')).toBe(false)
    expect(isBellKind('spawned')).toBe(false)
    expect(isBellKind('wrote')).toBe(false)
  })

  it('has a label and a tone for every kind', () => {
    const kinds: NotificationKind[] = [
      'turn',
      'question',
      'error',
      'prompt',
      'shape',
      'spawned',
      'wrote',
    ]
    for (const k of kinds) {
      expect(KIND_LABEL[k]).toBeTruthy()
      expect(KIND_TONE[k]).toBeTruthy()
    }
  })
})

describe('toneColor', () => {
  it('takes the agent´s accent for provider tone, and a fallback without one', () => {
    expect(toneColor('provider', 'codex')).toBe('var(--color-codex)')
    expect(toneColor('provider')).toBe('var(--color-fg-subtle)')
    expect(toneColor('danger')).toBe('var(--color-danger)')
    expect(toneColor('work')).toBe('var(--color-work)')
    expect(toneColor('attn')).toBe('var(--color-attn)')
  })
})

describe('runSince', () => {
  const entry = (ts: number): Notification => ({
    id: String(ts),
    sessionNodeId: 'n',
    sessionName: 'a',
    provider: 'claude',
    kind: 'turn',
    headline: 'x',
    tools: [],
    toolCount: 0,
    ts,
    read: true,
  })

  it('reads the oldest entry, the feed being newest-first', () => {
    expect(runSince([entry(300), entry(200), entry(100)])).toBe(100)
  })

  it('is null when nothing has happened', () => {
    expect(runSince([])).toBeNull()
  })
})

describe('checkTone', () => {
  it('colours a verdict by what it says, not by its kind', () => {
    expect(checkTone('checks pass in 4.2s')).toBe('live')
    expect(checkTone('checks fail (exit 1)')).toBe('danger')
    // A check that could not run is not a passing check.
    expect(checkTone('checks could not run — no such command')).toBe('danger')
  })
})
