/**
 * The bench, checked against the rules it is measuring.
 *
 * `bench/orchestration.md` is a hand-run benchmark, so nothing executes it —
 * which is exactly how a case comes to expect something the app would refuse.
 * A row asking for "single, 4 steps" would score a run as a pass on a plan
 * Canvastrator demotes to sequential on sight, and the bench would be measuring
 * the opposite of what it says.
 *
 * So the expectations are parsed out of the document itself rather than
 * duplicated here: one source of truth, and the table stays readable prose.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkShape, toPatternId } from './patterns'

type Case = { n: string; shape: string; steps: string }

const rows = (): Case[] => {
  const md = readFileSync(new URL('../../bench/orchestration.md', import.meta.url), 'utf8')
  return md
    .split('\n')
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()))
    .map(([, n, , shape, steps]) => ({ n, shape, steps }))
}

describe('the orchestration bench', () => {
  const cases = rows()

  it('has cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10)
  })

  it('names shapes the app knows, or none at all', () => {
    for (const c of cases) {
      if (c.shape === 'none') {
        // A case expecting no plan must expect no agents either, or it is two
        // different claims wearing one row.
        expect(c.steps, `case ${c.n}`).toBe('0')
        continue
      }
      expect(toPatternId(c.shape), `case ${c.n} shape "${c.shape}"`).not.toBeNull()
    }
  })

  it('expects step counts the app would let stand', () => {
    for (const c of cases) {
      if (c.shape === 'none') continue
      const id = toPatternId(c.shape)!
      expect(checkShape(id, Number(c.steps)), `case ${c.n}`).toBeNull()
    }
  })

  it('covers every rung, so restraint cannot be measured without the cases it would break', () => {
    const declared = new Set(cases.map((c) => c.shape).filter((s) => s !== 'none'))
    expect([...declared].sort()).toEqual([
      'chain',
      'evaluate',
      'orchestrate',
      'parallel',
      'single',
    ])
  })

  it('keeps at least one case that must produce no plan at all', () => {
    expect(cases.filter((c) => c.shape === 'none').length).toBeGreaterThan(0)
  })
})
