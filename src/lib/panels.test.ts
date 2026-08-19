import { describe, expect, it } from 'vitest'
import {
  FLOW_MIN,
  PANEL_RANGE,
  clampWidth,
  columnsWidth,
  parsePanels,
  tierFor,
  type PanelWidths,
} from './panels'

const DEFAULTS: PanelWidths = {
  canvases: PANEL_RANGE.canvases.default,
  chats: PANEL_RANGE.chats.default,
  files: PANEL_RANGE.files.default,
}

describe('clampWidth', () => {
  it('holds each column inside its own range', () => {
    expect(clampWidth('canvases', 40)).toBe(PANEL_RANGE.canvases.min)
    expect(clampWidth('canvases', 9000)).toBe(PANEL_RANGE.canvases.max)
    expect(clampWidth('files', 260.4)).toBe(260)
  })
})

describe('tierFor', () => {
  it('keeps every column when there is room for them and the flow region', () => {
    expect(tierFor(columnsWidth('full', DEFAULTS) + FLOW_MIN, DEFAULTS)).toBe('full')
  })

  it('steps down one tier at a time as the row narrows', () => {
    const tiers = (['full', 'compact', 'merged', 'rail'] as const).map((tier) =>
      // A pixel under what this tier costs is the first width it can't have.
      tierFor(columnsWidth(tier, DEFAULTS) + FLOW_MIN - 1, DEFAULTS),
    )
    expect(tiers).toEqual(['compact', 'merged', 'rail', 'rail'])
  })

  it('never leaves the flow region below its floor until there is nothing left to give up', () => {
    for (let row = 600; row <= 2000; row += 7) {
      const tier = tierFor(row, DEFAULTS)
      const flow = row - columnsWidth(tier, DEFAULTS)
      if (tier !== 'rail') expect(flow, `${row}px → ${tier}`).toBeGreaterThanOrEqual(FLOW_MIN)
    }
  })

  it('bottoms out at the rail rather than going negative', () => {
    expect(tierFor(0, DEFAULTS)).toBe('rail')
    expect(tierFor(320, DEFAULTS)).toBe('rail')
  })

  it('follows the widths it is given, not the defaults', () => {
    const wide: PanelWidths = { canvases: 320, chats: 320, files: 400 }
    const row = columnsWidth('full', DEFAULTS) + FLOW_MIN
    expect(tierFor(row, DEFAULTS)).toBe('full')
    expect(tierFor(row, wide)).not.toBe('full')
  })
})

describe('parsePanels', () => {
  it('defaults when there is nothing stored', () => {
    const p = parsePanels(null)
    expect(p.widths).toEqual(DEFAULTS)
    expect(p).toMatchObject({ collapsed: false, filesScope: 'chat', flowFocus: false })
  })

  it('carries the old sidebar preference over on first run', () => {
    expect(parsePanels(null, true).collapsed).toBe(true)
    // Once panels.ts has written its own key, that key wins.
    expect(parsePanels('{"collapsed":false}', true).collapsed).toBe(false)
  })

  it('round-trips what it writes', () => {
    const stored = {
      widths: { canvases: 240, chats: 200, files: 300 },
      collapsed: true,
      filesScope: 'all',
      flowFocus: true,
    }
    expect(parsePanels(JSON.stringify(stored))).toEqual(stored)
  })

  it('ignores anything it doesn’t recognise', () => {
    // A hand-edited file, or a key written by a version that knew more.
    for (const raw of ['', 'not json', 'null', '[]', '{"widths":"wide"}', '{"filesScope":"pizza"}']) {
      expect(parsePanels(raw).widths, raw).toEqual(DEFAULTS)
      expect(parsePanels(raw).filesScope, raw).toBe('chat')
    }
  })

  it('clamps stored widths, so a range change can’t strand a column off-screen', () => {
    const p = parsePanels('{"widths":{"canvases":9000,"files":10,"chats":null}}')
    expect(p.widths.canvases).toBe(PANEL_RANGE.canvases.max)
    expect(p.widths.files).toBe(PANEL_RANGE.files.min)
    expect(p.widths.chats).toBe(PANEL_RANGE.chats.default)
  })
})
