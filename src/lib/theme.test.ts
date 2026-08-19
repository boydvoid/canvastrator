import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseThemePref, resolveTheme } from './theme'

describe('parseThemePref', () => {
  it('keeps the three real choices', () => {
    expect(parseThemePref('dark')).toBe('dark')
    expect(parseThemePref('light')).toBe('light')
    expect(parseThemePref('system')).toBe('system')
  })

  it('falls back to dark for anything else', () => {
    // A hand-edited value, or a key written by a version that knew more themes.
    for (const raw of [null, undefined, '', 'DARK', 'solarized']) {
      expect(parseThemePref(raw)).toBe('dark')
    }
  })
})

describe('resolveTheme', () => {
  it('pins dark and light regardless of the system', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark')
    expect(resolveTheme('light', 'dark')).toBe('light')
  })

  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', 'light')).toBe('light')
    expect(resolveTheme('system', 'dark')).toBe('dark')
  })
})

// ── Palette contrast ──────────────────────────────────────────────────────
// The light theme is the one that can go wrong quietly: a token nudged a few
// points of lightness still looks fine on the author's screen and fails for
// everyone else. These read the real palette out of index.css so the numbers
// can't drift away from what ships.

type Oklch = [L: number, C: number, h: number]

/** oklch → linear sRGB, per the Oklab spec. */
function linearSrgb([L, C, hDeg]: Oklch): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number]
}

const luminance = (c: Oklch) => {
  const [r, g, b] = linearSrgb(c)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (fg: Oklch, bg: Oklch) => {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Every `--color-x: oklch(...)` declaration inside one CSS block. */
function paletteOf(selector: string): Record<string, Oklch> {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const start = css.indexOf(selector)
  expect(start, `${selector} not found in index.css`).toBeGreaterThan(-1)
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out: Record<string, Oklch> = {}
  for (const [, name, l, c, h] of block.matchAll(
    /--color-([a-z0-9-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g,
  )) {
    out[name] = [Number(l), Number(c), Number(h)]
  }
  return out
}

const light = paletteOf("html[data-theme='light']")

/** Text lands on one of these; a token has to clear AA on all of them. */
const SURFACES = ['canvas', 'panel', 'surface', 'surface-2']

describe('light palette', () => {
  it('defines every token the theme re-points', () => {
    for (const name of [...SURFACES, 'fg', 'fg-muted', 'fg-subtle', 'fg-faint', 'live', 'danger']) {
      expect(light[name], name).toBeDefined()
    }
  })

  // fg-strong is left out only because it's darker than fg and so passes by
  // construction — it's checked below with the rest all the same.
  it.each(['fg-strong', 'fg', 'fg-muted', 'fg-subtle', 'fg-faint'])(
    '%s meets WCAG AA as body text on every surface',
    (name) => {
      for (const bg of SURFACES) {
        expect(contrast(light[name], light[bg]), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  // Status is carried by colour in this app — a failed agent is red text, a
  // finished one is green — so the status colours are text, not decoration.
  it.each(['claude', 'codex', 'opencode', 'live', 'danger'])(
    '%s meets WCAG AA as status text on every surface',
    (name) => {
      for (const bg of SURFACES) {
        expect(contrast(light[name], light[bg]), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  it('keeps the text tiers in order, so hierarchy survives the theme', () => {
    const tiers = ['fg-strong', 'fg', 'fg-muted', 'fg-subtle', 'fg-faint']
    const ratios = tiers.map((t) => contrast(light[t], light.canvas))
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `${tiers[i]} vs ${tiers[i - 1]}`).toBeLessThan(ratios[i - 1])
    }
  })

  it('stacks surfaces the same way dark does — nearer the front is lighter', () => {
    expect(light.surface[0]).toBeGreaterThan(light.canvas[0])
    expect(light.panel[0]).toBeGreaterThan(light.canvas[0])
  })
})
