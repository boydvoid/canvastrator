import { beforeEach, describe, expect, it } from 'vitest'
import { addSeat, closeSeat, routeEvent, scrollTo, useDesk } from './desk'
import { activeStore, createCanvasStore, type CanvasStore } from './store'

/** A canvas with one agent on it, and that agent's session id. */
function withAgent(): { store: CanvasStore; sessionId: string; nodeId: string } {
  const store = createCanvasStore()
  const nodeId = store.getState().addSession('claude', { x: 0, y: 0 })
  const node = store.getState().nodes.find((n) => n.id === nodeId)!
  return { store, nodeId, sessionId: node.type === 'session' ? node.data.sessionId : '' }
}

const seat = (store: CanvasStore, key: string) => ({ key, store })

/** What the node was told, without needing a turn already in flight. */
const noticed = (store: CanvasStore, nodeId: string) => {
  const node = store.getState().nodes.find((n) => n.id === nodeId)
  return node?.type === 'session' ? node.data.notice?.detail : undefined
}

describe('routeEvent', () => {
  /**
   * The whole point of the desk. An agent's reply used to be handed to
   * whichever canvas was on screen, so leaving a squad working and going to
   * another canvas dropped everything they said while you were away — the
   * event arrived for a node the store no longer had.
   */
  it('delivers to the canvas that owns the session, not the one in view', () => {
    const here = withAgent()
    const away = withAgent()
    useDesk.setState({ strip: [seat(here.store, 'a'), seat(away.store, 'b')], at: 0 })

    routeEvent(away.sessionId, { kind: 'notice', label: 'retry', detail: 'still working' })

    expect(noticed(away.store, away.nodeId)).toBe('still working')
    // And nothing landed on the canvas you happen to be looking at.
    expect(noticed(here.store, here.nodeId)).toBeUndefined()
  })

  it('drops an event for a session no canvas has, rather than guessing', () => {
    const here = withAgent()
    useDesk.setState({ strip: [seat(here.store, 'a')], at: 0 })
    expect(() =>
      routeEvent('sess_gone', { kind: 'notice', label: 'x', detail: 'orphan' }),
    ).not.toThrow()
    expect(noticed(here.store, here.nodeId)).toBeUndefined()
  })
})

describe('the strip', () => {
  beforeEach(() => {
    const only = createCanvasStore()
    useDesk.setState({ strip: [seat(only, 'only')], at: 0 })
  })

  it('puts a new canvas beside the one you are on, and goes to it', () => {
    const first = useDesk.getState().strip[0]
    const added = addSeat()
    expect(useDesk.getState().strip.map((s) => s.key)).toEqual([first.key, added.key])
    expect(useDesk.getState().at).toBe(1)
    // Reading "the store" from anywhere outside a canvas now means this one.
    expect(activeStore()).toBe(added.store)
  })

  it('clamps a move to the ends of the strip', () => {
    addSeat()
    scrollTo(99)
    expect(useDesk.getState().at).toBe(1)
    scrollTo(-4)
    expect(useDesk.getState().at).toBe(0)
    expect(activeStore()).toBe(useDesk.getState().strip[0].store)
  })

  it('keeps the view on the same canvas when one to its left closes', () => {
    const a = useDesk.getState().strip[0]
    const b = addSeat()
    const c = addSeat()
    expect(useDesk.getState().at).toBe(2)
    closeSeat(a.key)
    expect(useDesk.getState().strip.map((s) => s.key)).toEqual([b.key, c.key])
    expect(useDesk.getState().strip[useDesk.getState().at].key).toBe(c.key)
  })

  /** A desk with nothing on it has nowhere to put the next node. */
  it('replaces the last canvas rather than emptying the desk', () => {
    const only = useDesk.getState().strip[0]
    closeSeat(only.key)
    expect(useDesk.getState().strip).toHaveLength(1)
    expect(useDesk.getState().strip[0].key).not.toBe(only.key)
    expect(activeStore()).toBe(useDesk.getState().strip[0].store)
  })
})

describe('a canvas added to the desk', () => {
  /**
   * Which CLIs are installed, where the working directory starts and what is
   * in the persona library are facts about the machine, fetched once at launch
   * onto whichever canvas was open. A canvas opened later without them could
   * not spawn anything at all — an empty provider list reads as "no agent is
   * installed", which is a lie the second canvas of a session should not tell.
   */
  it('inherits what the launch learned about the machine', () => {
    const first = createCanvasStore()
    useDesk.setState({ strip: [seat(first, 'first')], at: 0 })
    first.setState({
      providers: [{ provider: 'claude', available: true }] as never,
      cwd: '/Users/me/work',
      library: [{ id: 'p1', name: 'reviewer' }] as never,
    })

    const added = addSeat().store.getState()
    expect(added.providers).toEqual(first.getState().providers)
    expect(added.cwd).toBe('/Users/me/work')
    expect(added.library).toEqual(first.getState().library)
  })

  it('starts empty in every way that belongs to a canvas rather than the machine', () => {
    const first = createCanvasStore()
    useDesk.setState({ strip: [seat(first, 'first')], at: 0 })
    first.getState().addSession('claude', { x: 0, y: 0 })

    const added = addSeat().store.getState()
    expect(added.nodes).toEqual([])
    expect(added.canvasId).toBeNull()
  })
})
