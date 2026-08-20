/**
 * The parts of the terminal feature that are decidable without a DOM: what
 * gets saved, and what a canvas is allowed to claim about a shell.
 *
 * The emulator itself is xterm's, and the shell is a real process — neither is
 * worth faking here. What *is* worth pinning is the rule that a saved canvas
 * never carries live state, because the failure it prevents is silent: a node
 * that reopens insisting it has a shell it lost when the app closed.
 */
import { describe, expect, it } from 'vitest'
import { deserializeCanvas, serializeCanvas } from './persist'
import type { GtNode } from './store'

const terminal = (over: Record<string, unknown> = {}): GtNode =>
  ({
    id: 'node_t1',
    type: 'terminal',
    position: { x: 0, y: 0 },
    data: { terminalId: 'term_1', name: 'terminal', ...over },
  }) as never

const snapshot = (nodes: GtNode[]) =>
  ({
    nodes,
    edges: [],
    bus: [],
    delivered: {},
    cwd: '/tmp',
    autoPlaced: new Set<string>(),
    globalRules: '',
    notifications: [],
    planning: true,
    plan: null,
    orchestra: { provider: null, heavy: null, mid: null, light: null },
  }) as never

describe('a terminal across a save', () => {
  it('keeps what identifies it', () => {
    const saved = serializeCanvas(snapshot([terminal()]))
    expect(saved.nodes[0].data).toMatchObject({ terminalId: 'term_1', name: 'terminal' })
  })

  it('drops the shell it had, because the shell died with the app', () => {
    const saved = serializeCanvas(snapshot([terminal({ running: true, exit: { code: 0 } })]))
    expect(saved.nodes[0].data).not.toHaveProperty('running')
    expect(saved.nodes[0].data).not.toHaveProperty('exit')
  })

  it('reopens as a terminal with no shell rather than a lie about one', () => {
    const saved = serializeCanvas(snapshot([terminal({ running: true })]))
    const back = deserializeCanvas(saved)
    const node = back.nodes.find((n) => n.type === 'terminal')
    expect(node).toBeTruthy()
    expect(node?.data).not.toHaveProperty('running')
  })
})
