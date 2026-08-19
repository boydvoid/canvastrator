import type { Edge } from '@xyflow/react'
import { SESSION_SIZE } from './layout'
import type { GtNode } from './store'
import type { ContextEntry, Message, Notification, PersonalityNodeData } from './types'

/** Bumped when the saved shape changes in a way older files can't satisfy. */
export const CANVAS_VERSION = 1

/** The envelope on disk. The Rust side only reads the outer fields. */
export type CanvasDoc = {
  id: string
  name: string
  updatedAt: number
  version: number
  data: CanvasData
}

/** Enough to pick a canvas out of a list without opening it. */
export type CanvasMeta = {
  id: string
  name: string
  updatedAt: number
  version: number
  nodes: number
}

type SavedNode = {
  id: string
  type: GtNode['type']
  position: { x: number; y: number }
  width?: number
  height?: number
  data: unknown
}

export type CanvasData = {
  nodes: SavedNode[]
  edges: Edge[]
  bus: ContextEntry[]
  /** Sets aren't JSON, so watermarks are stored as arrays. */
  delivered: Record<string, string[]>
  cwd: string
  /** Node ids the layout owns. Everything else the user placed. */
  autoPlaced?: string[]
  /** Free-text rules every agent on this canvas is spawned with. */
  globalRules?: string
  notifications?: Notification[]
}

/** The slice of the store a canvas is made of. */
export type CanvasSnapshot = {
  nodes: GtNode[]
  edges: Edge[]
  bus: ContextEntry[]
  delivered: Record<string, Set<string>>
  cwd: string
  autoPlaced: Set<string>
  globalRules: string
  notifications: Notification[]
}

/**
 * Edge data worth keeping. `flowing` and `at` are animation timestamps, not
 * state: restoring them would light up traffic that isn't moving.
 */
const TRANSIENT_EDGE_KEYS = ['flowing', 'at']

function cleanEdgeData(data: Edge['data']): Edge['data'] | undefined {
  if (!data) return undefined
  const kept = Object.fromEntries(
    Object.entries(data).filter(([k]) => !TRANSIENT_EDGE_KEYS.includes(k)),
  )
  return Object.keys(kept).length ? kept : undefined
}

/**
 * A saved session is never mid-turn: its process dies with the app, so a
 * restored `thinking` node would spin forever waiting for events that can't
 * arrive. An error, though, is a real outcome and survives.
 */
function settleSession(data: Extract<GtNode, { type: 'session' }>['data']) {
  const messages: Message[] = (data.messages ?? [])
    // A pending message with no text is a placeholder for a reply that never came.
    .filter((m) => !(m.pending && !m.text))
    .map(({ pending: _pending, ...rest }) => rest)

  return {
    ...data,
    state: data.state === 'error' ? ('error' as const) : ('idle' as const),
    messages,
  }
}

export function serializeCanvas(s: CanvasSnapshot): CanvasData {
  const nodes: SavedNode[] = s.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    // React Flow also hangs `selected`, `dragging` and `measured` off nodes;
    // saving those would restore a canvas mid-drag.
    ...(n.width ? { width: n.width } : {}),
    ...(n.height ? { height: n.height } : {}),
    data: n.type === 'session' ? settleSession(n.data) : n.data,
  }))

  const ids = new Set(nodes.map((n) => n.id))

  return {
    nodes,
    edges: s.edges
      // `call` edges exist only while a delegated call is in flight.
      .filter((e) => e.type !== 'call')
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => {
        const data = cleanEdgeData(e.data)
        const { data: _drop, ...rest } = e
        return (data ? { ...rest, data } : rest) as Edge
      }),
    bus: s.bus,
    delivered: Object.fromEntries(Object.entries(s.delivered).map(([k, v]) => [k, [...v]])),
    cwd: s.cwd,
    // Only ids still on the canvas; a deleted node's id is dead weight.
    // Tolerant of a snapshot without the field: a missing set should never
    // be the reason a canvas fails to save.
    autoPlaced: [...(s.autoPlaced ?? [])].filter((id) => ids.has(id)),
    globalRules: s.globalRules ?? '',
    notifications: s.notifications ?? [],
  }
}

/**
 * Rebuild the store slice from a file. Deliberately forgiving: a canvas that
 * lost a node to a bad write should open with what's left, not refuse to open.
 */
/**
 * Personas stranded on an older canvas.
 *
 * Personality nodes are gone — a persona is edited on the agent it configures,
 * and the reusable templates live in the library. But canvases saved before
 * that still carry them, and a user who defined "reviewer" by right-clicking
 * the canvas never put it in the library. Dropping those nodes without
 * rescuing what they held would delete the user's work, so the load path
 * hoists them first.
 */
export function strandedPersonas(data: CanvasData | null | undefined): PersonalityNodeData[] {
  return (data?.nodes ?? [])
    .filter((n) => (n?.type as string) === 'personality' && n.data && typeof n.data === 'object')
    .map((n) => n.data as PersonalityNodeData)
    .filter((d) => typeof d.name === 'string' && d.name.trim() !== '')
}

export function deserializeCanvas(data: CanvasData | null | undefined): CanvasSnapshot {
  const nodes = (data?.nodes ?? []).filter(
    (n): n is SavedNode => !!n && typeof n.id === 'string' && typeof n.type === 'string',
  )
  // Personality and summary nodes no longer exist. `strandedPersonas` rescues
  // what the first kind held; a turn summary is only worth reading while the
  // turn is recent, so those simply go. The attach and summary edges that
  // wired them in fall out with the dangling-edge filter below.
  .filter((n) => !['personality', 'summary'].includes(n.type as string))

  const ids = new Set(nodes.map((n) => n.id))

  return {
    nodes: nodes.map((n) => {
      const node = {
        id: n.id,
        type: n.type,
        position: n.position ?? { x: 0, y: 0 },
        ...(n.width ? { width: n.width } : {}),
        ...(n.height ? { height: n.height } : {}),
        data: n.data,
      } as GtNode
      // Agent nodes used to be resizable transcript windows, so canvases saved
      // then carry whatever size the user dragged them to. They are labels
      // now: one size, or an old canvas opens full of empty boxes.
      if (node.type === 'session') {
        node.width = SESSION_SIZE.w
        node.height = SESSION_SIZE.h
      }
      // Belt and braces: files written before settleSession existed, or edited
      // by hand, must still open in a usable state.
      if (node.type === 'session') node.data = settleSession(node.data)
      return node
    }),
    edges: (data?.edges ?? [])
      .filter((e) => !!e && e.type !== 'call')
      .filter((e) => ids.has(e.source) && ids.has(e.target)),
    bus: data?.bus ?? [],
    delivered: Object.fromEntries(
      Object.entries(data?.delivered ?? {}).map(([k, v]) => [k, new Set(v)]),
    ),
    cwd: data?.cwd ?? '',
    // Absent in canvases saved before this existed. Empty means the layout
    // owns nothing, which errs toward leaving the user's arrangement alone.
    autoPlaced: new Set(data?.autoPlaced ?? []),
    // Absent in canvases saved before this existed, and empty means the same
    // thing it does when the user clears the field: inject nothing.
    globalRules: data?.globalRules ?? '',
    // Absent before the bell existed. The summary nodes these replaced are
    // dropped above; their content isn't rescued, because a turn's headline is
    // only useful while the turn is recent.
    notifications: (data?.notifications ?? []).filter(
      (n): n is Notification => !!n && typeof n.id === 'string',
    ),
  }
}
