import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { basename, globalRulesBlock, resolveCwd, type GtNode } from './store'

const folder = (id: string, path: string): GtNode => ({
  id,
  type: 'folder',
  position: { x: 0, y: 0 },
  data: { folderId: id, path },
})

const session = (id: string): GtNode => ({
  id,
  type: 'session',
  position: { x: 0, y: 0 },
  data: {
    sessionId: id,
    provider: 'claude',
    role: 'worker',
    name: id,
    cwd: '',
    state: 'idle',
    permission: 'auto',
    messages: [],
    usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    skillIds: [],
  },
})

const cwdEdge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: 'cwd',
})

describe('basename', () => {
  it('returns the last path segment', () => {
    expect(basename('/Users/me/code/gridterm')).toBe('gridterm')
  })

  it('ignores trailing slashes', () => {
    expect(basename('/Users/me/code/gridterm///')).toBe('gridterm')
  })

  it('falls back to the input when there is no segment', () => {
    expect(basename('/')).toBe('/')
    expect(basename('')).toBe('')
  })

  it('passes through a bare name', () => {
    expect(basename('README.md')).toBe('README.md')
  })
})

describe('resolveCwd', () => {
  const nodes = [folder('f1', '/tmp/project'), session('s1'), session('s2')]

  it('reads the path off the folder wired into the session', () => {
    const edges = [cwdEdge('f1', 's1')]
    expect(resolveCwd(nodes, edges, 's1')).toBe('/tmp/project')
  })

  it('returns null when nothing is wired in', () => {
    expect(resolveCwd(nodes, [], 's1')).toBeNull()
  })

  it('ignores edges aimed at a different session', () => {
    const edges = [cwdEdge('f1', 's2')]
    expect(resolveCwd(nodes, edges, 's1')).toBeNull()
  })

  it('ignores non-cwd edges', () => {
    const edges = [{ ...cwdEdge('f1', 's1'), type: 'context' }]
    expect(resolveCwd(nodes, edges, 's1')).toBeNull()
  })

  it('returns null when the edge source is not a folder', () => {
    const edges = [cwdEdge('s2', 's1')]
    expect(resolveCwd(nodes, edges, 's1')).toBeNull()
  })

  it('returns null when the edge source node is gone', () => {
    const edges = [cwdEdge('missing', 's1')]
    expect(resolveCwd(nodes, edges, 's1')).toBeNull()
  })
})

describe('globalRulesBlock', () => {
  it('wraps the rules verbatim', () => {
    expect(globalRulesBlock('Never push to main.\nRun the tests.')).toBe(
      '<canvas-global-rules>\nNever push to main.\nRun the tests.\n</canvas-global-rules>',
    )
  })

  it('injects nothing when there are no rules', () => {
    // Empty tags would read as "you have been given rules, and they are none".
    expect(globalRulesBlock('')).toBe('')
    expect(globalRulesBlock('  \n\t ')).toBe('')
  })
})
