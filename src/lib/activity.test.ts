import { describe, expect, it } from 'vitest'
import { isTouchLive } from './activity'
import type { SessionNodeData } from './types'

const session = (over: Partial<SessionNodeData>): SessionNodeData =>
  ({
    sessionId: 's',
    provider: 'claude',
    role: 'worker',
    name: 's',
    cwd: '/tmp',
    state: 'idle',
    permission: 'auto',
    messages: [],
    usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    skillIds: [],
    ...over,
  }) as SessionNodeData

describe('is an agent still on this file', () => {
  it('is live for a touch inside the running turn', () => {
    expect(isTouchLive(session({ state: 'streaming', turnStartedAt: 100 }), 150)).toBe(true)
  })

  it('goes quiet the moment the turn ends', () => {
    expect(isTouchLive(session({ state: 'idle', turnStartedAt: 100 }), 150)).toBe(false)
  })

  it('ignores files touched by an earlier turn of a busy session', () => {
    expect(isTouchLive(session({ state: 'thinking', turnStartedAt: 200 }), 150)).toBe(false)
  })

  it('is never live without a touch', () => {
    expect(isTouchLive(session({ state: 'streaming', turnStartedAt: 100 }))).toBe(false)
  })
})
