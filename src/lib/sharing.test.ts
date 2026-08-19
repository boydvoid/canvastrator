import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import {
  filesKnown,
  filesKnownBlock,
  filesKnownEntry,
  filesKnownKey,
  orchestraBlock,
  orchestraKey,
  orchestratorBlock,
  peerKey,
  peersBlock,
  peersEndedBlock,
  standingBlock,
  rosterKey,
  rosterUpdateBlock,
  type GtNode,
} from './store'
import type { Persona } from './library'
import { DEFAULT_ORCHESTRA } from './types'

const persona = (over: Partial<Persona> = {}): Persona => ({
  id: 'p1',
  name: 'reviewer',
  description: 'reviews code',
  provider: 'claude',
  permission: 'plan',
  instructions: 'you review',
  ...over,
})

const session = (id: string, name = id): GtNode => ({
  id,
  type: 'session',
  position: { x: 0, y: 0 },
  data: {
    sessionId: `s_${id}`,
    provider: 'claude',
    role: 'worker',
    name,
    cwd: '',
    state: 'idle',
    permission: 'auto',
    messages: [],
    usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    skillIds: [],
  },
})

const file = (id: string, path: string, written = false): GtNode => ({
  id,
  type: 'file',
  position: { x: 0, y: 0 },
  data: { fileId: id, path, origin: 'agent', ...(written ? { written: true } : {}) },
})

/** An agent touched a file: session → file. */
const touched = (session: string, file: string): Edge => ({
  id: `${session}->${file}`,
  source: session,
  target: file,
  type: 'file',
})

/** A file is wired in as context: file → session. */
const attached = (file: string, session: string): Edge => ({
  id: `${file}->${session}`,
  source: file,
  target: session,
  type: 'file',
})

describe('rosterKey', () => {
  it('is the same for a roster that only changed order', () => {
    const a = [persona({ id: '1', name: 'a' }), persona({ id: '2', name: 'b' })]
    expect(rosterKey(a)).toBe(rosterKey([...a].reverse()))
  })

  it('changes when routing would change', () => {
    const base = [persona()]
    expect(rosterKey(base)).not.toBe(rosterKey([persona({ description: 'reviews prose' })]))
    expect(rosterKey(base)).not.toBe(rosterKey([...base, persona({ id: '2', name: 'writer' })]))
    expect(rosterKey(base)).not.toBe(rosterKey([persona({ model: 'claude-opus-5' })]))
    expect(rosterKey(base)).not.toBe(rosterKey([persona({ permission: 'full' })]))
  })

  it('ignores what routing never sees', () => {
    // The id and the brief are not shown to the orchestrator, so a change to
    // either must not cost a turn's tokens telling it about them.
    expect(rosterKey([persona()])).toBe(
      rosterKey([persona({ id: 'different', instructions: 'rewritten entirely' })]),
    )
  })
})

describe('rosterUpdateBlock', () => {
  it('is a fraction of the size of the full brief', () => {
    const roster = [persona()]
    expect(rosterUpdateBlock(roster).length).toBeLessThan(
      orchestratorBlock(roster, false).length / 4,
    )
  })

  it('says it replaces the earlier list, so the agent drops a deleted persona', () => {
    expect(rosterUpdateBlock([persona()])).toContain('replaces')
    expect(rosterUpdateBlock([persona()])).toContain('reviewer')
  })

  it('survives an emptied library without claiming there are personas', () => {
    expect(rosterUpdateBlock([])).toContain('(none)')
  })
})

describe('orchestratorBlock', () => {
  it('carries the protocol for the mode it was built in', () => {
    expect(orchestratorBlock([persona()], false)).toContain('SPAWN <persona-name>')
    expect(orchestratorBlock([persona()], false)).not.toContain('PLANNING MODE')
    expect(orchestratorBlock([persona()], true)).toContain('PLANNING MODE')
    expect(orchestratorBlock([persona()], true)).toContain('PLAN <persona-name>')
  })

  it('lists the roster it was given', () => {
    expect(orchestratorBlock([persona({ name: 'api-critic' })], false)).toContain('api-critic')
    expect(orchestratorBlock([], false)).toContain('(none yet)')
  })

  it('carries a model preference only when one is set', () => {
    expect(orchestratorBlock([persona()], false)).not.toContain('canvastrator-model-preference')
    expect(
      orchestratorBlock([persona()], false, { ...DEFAULT_ORCHESTRA, heavy: 'claude-opus-5' }),
    ).toContain('canvastrator-model-preference')
  })
})

describe('orchestraBlock', () => {
  it('says nothing when the user has expressed no preference', () => {
    expect(orchestraBlock(DEFAULT_ORCHESTRA)).toBe('')
  })

  it('names only the fields that are set', () => {
    const block = orchestraBlock({ ...DEFAULT_ORCHESTRA, provider: 'codex', light: 'gpt-5' })
    expect(block).toContain('Spawn on codex')
    expect(block).toContain('gpt-5')
    expect(block).not.toContain('architecture')
  })

  it('moves its key when any field changes, so a briefed agent is told again', () => {
    const base = { ...DEFAULT_ORCHESTRA, heavy: 'claude-opus-5' }
    expect(orchestraKey(base)).toBe(orchestraKey({ ...base }))
    expect(orchestraKey(base)).not.toBe(orchestraKey({ ...base, mid: 'claude-sonnet-5' }))
    expect(orchestraKey(base)).not.toBe(orchestraKey(DEFAULT_ORCHESTRA))
  })
})

describe('peersBlock', () => {
  const peers = [
    { name: 'reviewer', provider: 'claude' as const },
    { name: 'builder', provider: 'codex' as const },
  ]

  it('lists every peer with its provider', () => {
    const block = peersBlock(peers)
    expect(block).toContain('- reviewer (claude)')
    expect(block).toContain('- builder (codex)')
    expect(block).toContain('DELEGATE <agent-name>')
  })

  it('is empty when there is nobody to delegate to', () => {
    expect(peersBlock([])).toBe('')
  })

  it('keys on the set, not the order', () => {
    expect(peerKey(peers)).toBe(peerKey([...peers].reverse()))
    expect(peerKey(peers)).not.toBe(peerKey([peers[0]]))
  })
})

describe('filesKnown', () => {
  const nodes = [session('a', 'reviewer'), session('b', 'builder'), file('f1', '/repo/store.ts')]

  it('names the file and who opened it', () => {
    expect(filesKnown(nodes, [touched('a', 'f1')], 'b')).toEqual([
      { path: '/repo/store.ts', by: ['reviewer'], written: false },
    ])
  })

  it('says when a file was changed rather than read', () => {
    const written = [session('a', 'reviewer'), session('b'), file('f1', '/repo/store.ts', true)]
    expect(filesKnown(written, [touched('a', 'f1')], 'b')[0].written).toBe(true)
    expect(filesKnownBlock(filesKnown(written, [touched('a', 'f1')], 'b'))).toContain(
      'changed by reviewer',
    )
  })

  it('leaves out the reader\'s own reads — it does not need its own map', () => {
    expect(filesKnown(nodes, [touched('b', 'f1')], 'b')).toEqual([])
  })

  it('leaves out a file that is wired into this session, which arrives in full', () => {
    const edges = [touched('a', 'f1'), attached('f1', 'b')]
    expect(filesKnown(nodes, edges, 'b')).toEqual([])
  })

  it('leaves out a file nobody has opened', () => {
    // A file the user dropped on the canvas and wired to nothing tells a
    // reader nothing it could act on.
    expect(filesKnown(nodes, [], 'b')).toEqual([])
  })

  it('credits everyone who opened it', () => {
    const out = filesKnown(nodes, [touched('a', 'f1'), touched('b', 'f1')], 'c')
    expect(out[0].by.sort()).toEqual(['builder', 'reviewer'])
  })
})

describe('filesKnownKey', () => {
  const nodes = [session('a', 'reviewer'), file('f1', '/repo/x.ts')]
  const known = filesKnown(nodes, [touched('a', 'f1')], 'b')

  it('changes when a file is added, or goes from read to changed', () => {
    const more = filesKnown(
      [...nodes, file('f2', '/repo/y.ts')],
      [touched('a', 'f1'), touched('a', 'f2')],
      'b',
    )
    expect(filesKnownKey(known)).not.toBe(filesKnownKey(more))

    const edited = filesKnown([session('a', 'reviewer'), file('f1', '/repo/x.ts', true)], [touched('a', 'f1')], 'b')
    expect(filesKnownKey(known)).not.toBe(filesKnownKey(edited))
  })

  it('is built from the same entries the block is, so a delta can be taken', () => {
    // `send` diffs the previous key against today's entries; if these two
    // disagreed, every turn would re-send the whole map.
    const had = new Set(filesKnownKey(known).split('\n'))
    expect(known.every((f) => had.has(filesKnownEntry(f)))).toBe(true)
  })
})

describe('filesKnownBlock', () => {
  it('is empty when there is nothing new to say', () => {
    expect(filesKnownBlock([])).toBe('')
  })

  it('caps a busy canvas and admits what it left out', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      path: `/repo/f${i}.ts`,
      by: ['reviewer'],
      written: false,
    }))
    const block = filesKnownBlock(many)
    expect(block).toContain('/repo/f0.ts')
    expect(block).not.toContain('/repo/f59.ts')
    expect(block).toContain('and 20 more')
  })
})

describe('peersEndedBlock', () => {
  it('retracts the names rather than leaving them standing', () => {
    // peersBlock([]) is empty, so without this the orchestrator keeps
    // delegating to agents that have been deleted from the canvas.
    expect(peersBlock([])).toBe('')
    expect(peersEndedBlock()).toContain('no other agents')
    expect(peersEndedBlock()).toContain('do not delegate')
  })
})

describe('standingBlock', () => {
  it('tells every agent that a block missing from a later turn still applies', () => {
    // Without this, an agent that stops seeing its folder block can reasonably
    // conclude the folders were withdrawn, and start asking where they went.
    const block = standingBlock()
    expect(block).toContain('stays in force')
    expect(block).toContain('has not been withdrawn')
  })

  it('is small enough to be worth sending', () => {
    expect(standingBlock().length).toBeLessThan(600)
  })
})
