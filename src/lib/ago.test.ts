import { describe, expect, it } from 'vitest'
import { timeAgo } from './ago'

const NOW = new Date('2026-08-18T12:00:00Z').getTime()
const ago = (ms: number) => timeAgo(NOW - ms, NOW)

describe('timeAgo', () => {
  it('calls anything within the last minute "just now"', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(44_000)).toBe('just now')
  })

  it('steps up through minutes, hours and days', () => {
    expect(ago(5 * 60_000)).toBe('5m ago')
    expect(ago(3 * 3_600_000)).toBe('3h ago')
    expect(ago(2 * 86_400_000)).toBe('2d ago')
  })

  it('switches to a date once the relative form stops meaning anything', () => {
    expect(ago(30 * 86_400_000)).not.toMatch(/ago/)
  })

  /** Clocks drift, and a notification from "the future" must not read as -3m. */
  it('never goes negative', () => {
    expect(timeAgo(NOW + 60_000, NOW)).toBe('just now')
  })
})
