import { describe, expect, it } from 'vitest'
import { justWentQuiet } from './chime'

describe('justWentQuiet', () => {
  it('fires on the transition from working to idle', () => {
    expect(justWentQuiet(true, false)).toBe(true)
  })

  /** A canvas that was already quiet must not chime on unrelated changes. */
  it('stays silent when nothing was running', () => {
    expect(justWentQuiet(false, false)).toBe(false)
  })

  it('stays silent while work is still going', () => {
    expect(justWentQuiet(true, true)).toBe(false)
    expect(justWentQuiet(false, true)).toBe(false)
  })
})
