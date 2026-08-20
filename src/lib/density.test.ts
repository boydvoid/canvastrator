import { describe, expect, it } from 'vitest'
import {
  cycleDensity,
  densityForZoom,
  densityOf,
  DENSITY_SIZE,
  GLANCE_BELOW,
  parseDensity,
} from './density'

describe('densityForZoom', () => {
  it('drops to glance below the threshold and not at it', () => {
    expect(densityForZoom(GLANCE_BELOW - 0.01)).toBe('glance')
    expect(densityForZoom(GLANCE_BELOW)).toBe('summary')
  })

  it('never picks full', () => {
    // There is no zoom at which every agent on the canvas should open its
    // transcript, so `full` is only ever reached by pinning one.
    for (const zoom of [0.2, 0.5, 1, 1.6, 4]) {
      expect(densityForZoom(zoom)).not.toBe('full')
    }
  })
})

describe('densityOf', () => {
  it('lets a pin win at any zoom', () => {
    expect(densityOf('full', 0.2)).toBe('full')
    expect(densityOf('glance', 1.6)).toBe('glance')
    expect(densityOf('summary', 0.2)).toBe('summary')
  })

  it('follows the zoom when nothing is pinned', () => {
    expect(densityOf(undefined, 0.3)).toBe('glance')
    expect(densityOf(undefined, 1)).toBe('summary')
  })
})

describe('cycleDensity', () => {
  it('climbs the ladder and wraps', () => {
    expect(cycleDensity('glance')).toBe('summary')
    expect(cycleDensity('summary')).toBe('full')
    expect(cycleDensity('full')).toBe('glance')
  })
})

describe('DENSITY_SIZE', () => {
  it('gets wider as it says more', () => {
    expect(DENSITY_SIZE.glance.w).toBeLessThan(DENSITY_SIZE.summary.w)
    expect(DENSITY_SIZE.summary.w).toBeLessThan(DENSITY_SIZE.full.w)
  })
})

describe('parseDensity', () => {
  it('accepts the three rungs and rejects everything else', () => {
    expect(parseDensity('glance')).toBe('glance')
    expect(parseDensity('full')).toBe('full')
    // A hand-edited canvas, or a key from a later version, is not a density.
    expect(parseDensity('enormous')).toBeUndefined()
    expect(parseDensity(null)).toBeUndefined()
    expect(parseDensity(2)).toBeUndefined()
  })
})
