import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { spawnDepth } from './store'

const spawn = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: 'spawn',
})

describe('spawnDepth', () => {
  it('is zero for an agent nobody spawned', () => {
    expect(spawnDepth([], 'orch')).toBe(0)
    expect(spawnDepth([spawn('orch', 'a')], 'orch')).toBe(0)
  })

  it('counts the chain up to the orchestrator', () => {
    const edges = [spawn('orch', 'a'), spawn('a', 'b'), spawn('b', 'c')]
    expect(spawnDepth(edges, 'a')).toBe(1)
    expect(spawnDepth(edges, 'b')).toBe(2)
    expect(spawnDepth(edges, 'c')).toBe(3)
  })

  /**
   * The bug this replaced: depth was a counter that only ever went up, so an
   * orchestrator was refused after its second spawn for the rest of the
   * session. Depth read off the graph doesn't move when a sibling is added.
   */
  it('does not grow as an agent gains siblings', () => {
    const edges = [spawn('orch', 'a'), spawn('orch', 'b'), spawn('orch', 'c')]
    expect(spawnDepth(edges, 'a')).toBe(1)
    expect(spawnDepth(edges, 'c')).toBe(1)
    expect(spawnDepth(edges, 'orch')).toBe(0)
  })

  it('ignores non-spawn edges', () => {
    const edges: Edge[] = [
      { id: 'c1', source: 'orch', target: 'a', type: 'context' },
      { id: 'f1', source: 'orch', target: 'a', type: 'file' },
    ]
    expect(spawnDepth(edges, 'a')).toBe(0)
  })

  it('terminates on a spawn cycle', () => {
    const edges = [spawn('a', 'b'), spawn('b', 'a')]
    expect(() => spawnDepth(edges, 'a')).not.toThrow()
    expect(spawnDepth(edges, 'a')).toBeLessThan(5)
  })
})
