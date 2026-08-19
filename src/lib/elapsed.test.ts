import { describe, expect, it } from 'vitest'
import { formatElapsed } from '@/components/RunningStatus'

describe('formatElapsed', () => {
  it('shows seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(45)).toBe('45s')
  })

  it('shows minutes and zero-padded seconds', () => {
    expect(formatElapsed(60)).toBe('1m 00s')
    expect(formatElapsed(125)).toBe('2m 05s')
    expect(formatElapsed(3599)).toBe('59m 59s')
  })

  /** Long-running is the case this exists for; it must not read as "119m". */
  it('rolls over to hours', () => {
    expect(formatElapsed(3600)).toBe('1h 00m')
    expect(formatElapsed(7325)).toBe('2h 02m')
  })
})
