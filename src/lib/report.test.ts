import { describe, expect, it } from 'vitest'
import { handBack, parseReport, REPORT_FALLBACK_CHARS, reportBlock } from './report'

describe('parseReport', () => {
  it('takes the block and everything after it', () => {
    const reply = 'I read the store.\n\nREPORT: store.ts:1100 builds the prompt.\nNothing else touched.'
    expect(parseReport(reply)).toBe('store.ts:1100 builds the prompt.\nNothing else touched.')
  })

  it('is case-insensitive on the keyword', () => {
    expect(parseReport('report: done')).toBe('done')
  })

  it('takes the last block, not the first', () => {
    // A worker asked to end with a report may write an interim one first.
    const reply = 'REPORT: read the file.\n\nThen I fixed it.\n\nREPORT: the real one.'
    expect(parseReport(reply)).toBe('the real one.')
  })

  it('ignores the word inside a sentence', () => {
    // Anchored to the start of a line, so prose that happens to contain the
    // keyword is not mistaken for the block.
    expect(parseReport('I will write a REPORT: block when done.')).toBeNull()
    expect(parseReport('I finished the report for you.')).toBeNull()
  })

  it('is null when there is no block, or an empty one', () => {
    expect(parseReport('Just a reply.')).toBeNull()
    expect(parseReport('REPORT:')).toBeNull()
    expect(parseReport('REPORT:   \n  ')).toBeNull()
    expect(parseReport('')).toBeNull()
  })
})

describe('handBack', () => {
  it('passes the report on when there is one', () => {
    const long = 'x'.repeat(REPORT_FALLBACK_CHARS * 2)
    expect(handBack(`${long}\n\nREPORT: two lines of result`)).toEqual({
      body: 'two lines of result',
      summarised: true,
      truncated: false,
    })
  })

  it('passes a short reply through whole when there is no report', () => {
    expect(handBack('  Found nothing.  ')).toEqual({
      body: 'Found nothing.',
      summarised: false,
      truncated: false,
    })
  })

  it('cuts a long reply that forgot the protocol', () => {
    const out = handBack('y'.repeat(REPORT_FALLBACK_CHARS + 500))
    expect(out.truncated).toBe(true)
    expect(out.summarised).toBe(false)
    expect(out.body).toHaveLength(REPORT_FALLBACK_CHARS)
  })

  it('never grows what it was given', () => {
    const reply = 'z'.repeat(REPORT_FALLBACK_CHARS * 3)
    expect(handBack(reply).body.length).toBeLessThanOrEqual(REPORT_FALLBACK_CHARS)
  })
})

describe('reportBlock', () => {
  it('names the agent and its role when they differ', () => {
    const block = reportBlock('reviewer-2', 'reviewer', handBack('REPORT: clean'))
    expect(block).toContain('reviewer-2 (a reviewer) reported:')
    expect(block).toContain('clean')
    expect(block).toContain('from="reviewer-2"')
  })

  it('does not repeat the name when it is the persona name', () => {
    expect(reportBlock('reviewer', 'reviewer', handBack('REPORT: clean'))).toContain(
      'reviewer reported:',
    )
    expect(reportBlock('reviewer', 'reviewer', handBack('REPORT: clean'))).not.toContain('(a ')
  })

  it('says so when the reply was cut, so it cannot read as a complete answer', () => {
    const block = reportBlock('w', 'worker', handBack('q'.repeat(REPORT_FALLBACK_CHARS + 1)))
    expect(block).toContain('cut short')
    expect(block).toContain('verbatim="true"')
  })

  it('marks an unsummarised short reply verbatim but does not claim it was cut', () => {
    const block = reportBlock('w', 'worker', handBack('all done'))
    expect(block).toContain('verbatim="true"')
    expect(block).not.toContain('cut short')
  })
})
