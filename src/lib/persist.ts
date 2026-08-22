import type { Edge } from '@xyflow/react'
import { reconcileFolderEdges, type GtNode } from './store'
import {
  DEFAULT_ORCHESTRA,
  DEFAULT_PANELS,
  MODEL_TIERS,
  PANEL_KEYS,
  type ContextEntry,
  type Message,
  type Notification,
  type OrchestraPrefs,
  type Panels,
  type PersonalityNodeData,
  type Plan,
} from './types'

/** Bumped when the saved shape changes in a way older files can't satisfy. */
export const CANVAS_VERSION = 1

/** The envelope on disk. The Rust side only reads the outer fields. */
export type CanvasDoc = {
  id: string
  name: string
  updatedAt: number
  /**
   * When the canvas was first written. Optional on the way in — the Rust side
   * fills it from the file so a save can't drop it — and always present on the
   * way out.
   */
  createdAt?: number
  version: number
  data: CanvasData
}

/** Enough to pick a canvas out of a list without opening it. */
export type CanvasMeta = {
  id: string
  name: string
  updatedAt: number
  /** What the list is ordered by. Fixed for the life of the canvas. */
  createdAt: number
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
  /** Whether the orchestrator proposes work rather than starting it. */
  planning?: boolean
  /** Whether each new agent gets its own git worktree. */
  isolateSpawns?: boolean
  /** The command that decides whether this canvas's work is any good. */
  checkCommand?: string
  /** Operations this canvas holds back until the user allows them. */
  guards?: string[]
  /** Which models the user wants this canvas's orchestrator reaching for. */
  orchestra?: OrchestraPrefs
  /**
   * Plans the user hasn't finished with.
   *
   * `plan` is what canvases saved when one was all a canvas could hold. It is
   * still read, because a file written last week is not wrong — it just knew
   * of one.
   */
  plans?: Plan[]
  plan?: Plan | null
  /** Which floating readouts are showing, and which are folded to a header. */
  panels?: Panels
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
  planning: boolean
  /** Optional for the same reason as `panels`: a partial test snapshot. */
  isolateSpawns?: boolean
  checkCommand?: string
  guards?: string[]
  plans: Plan[]
  /**
   * Optional for the same reason as `orchestra`: a partial snapshot built by a
   * test predates the field, and absent means "however the panels start".
   */
  panels?: Panels
  /**
   * Optional so a caller that predates the preference — the tests, and any
   * partial snapshot — still type-checks; absent saves as "no preference",
   * which is what an untouched canvas means anyway.
   */
  orchestra?: OrchestraPrefs
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

/**
 * A terminal, minus everything that was true only while the app was running.
 *
 * The shell dies with the process, so a saved `running: true` would reopen as
 * a node claiming a live terminal that does not exist — and the exit code of a
 * shell from a previous run of the app is not news either.
 */
function settleTerminal(data: Extract<GtNode, { type: 'terminal' }>['data']) {
  const { running: _running, exit: _exit, ...rest } = data
  return rest
}

export function serializeCanvas(s: CanvasSnapshot): CanvasData {
  // A worktree that was named but never cut is a half-typed intention, not a
  // directory: saving it would restore a canvas with a text field waiting on
  // a branch nobody remembers wanting.
  const live = s.nodes.filter((n) => !(n.type === 'folder' && n.data.draft))
  const nodes: SavedNode[] = live.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    // React Flow also hangs `selected`, `dragging` and `measured` off nodes;
    // saving those would restore a canvas mid-drag.
    ...(n.width ? { width: n.width } : {}),
    ...(n.height ? { height: n.height } : {}),
    data:
      n.type === 'session'
        ? settleSession(n.data)
        : n.type === 'terminal'
          ? settleTerminal(n.data)
          : n.data,
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
    planning: s.planning ?? true,
    isolateSpawns: s.isolateSpawns ?? false,
    checkCommand: s.checkCommand ?? '',
    guards: s.guards ?? [],
    orchestra: { ...DEFAULT_ORCHESTRA, ...(s.orchestra ?? {}) },
    panels: { ...DEFAULT_PANELS, ...(s.panels ?? {}) },
    plans: s.plans.map((p) => ({
      ...p,
      steps: p.steps.map((st) =>
        st.state === 'running' ? { ...st, state: 'pending' as const } : st,
      ),
    })),
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

/** Only the fields still recognised, and only when they are strings. */
function readOrchestra(raw: OrchestraPrefs | undefined): OrchestraPrefs {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const provider = str(raw?.provider)
  return {
    provider: provider === 'claude' || provider === 'codex' || provider === 'opencode' ? provider : null,
    ...(Object.fromEntries(MODEL_TIERS.map((t) => [t, str(raw?.[t])])) as Record<
      (typeof MODEL_TIERS)[number],
      string | null
    >),
  }
}

/**
 * Panel prefs, key by key. A hand-edited file or one from a build that knew a
 * panel this one doesn't must never put a key the stack can't render into the
 * store, and a missing panel takes its default rather than opening as
 * `undefined`.
 */
function readPanels(raw: Panels | undefined): Panels {
  const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return Object.fromEntries(
    PANEL_KEYS.map((key) => [
      key,
      {
        open: flag(raw?.[key]?.open, DEFAULT_PANELS[key].open),
        minimized: flag(raw?.[key]?.minimized, DEFAULT_PANELS[key].minimized),
      },
    ]),
  ) as Panels
}

export function deserializeCanvas(data: CanvasData | null | undefined): CanvasSnapshot {
  const nodes = (data?.nodes ?? []).filter(
    (n): n is SavedNode => !!n && typeof n.id === 'string' && typeof n.type === 'string',
  )
  // Personality and summary nodes no longer exist. `strandedPersonas` rescues
  // what the first kind held; a turn summary is only worth reading while the
  // turn is recent, so those simply go. The attach and summary edges that
  // wired them in fall out with the dangling-edge filter below.
  // Pulse and Usage are floating panels now rather than nodes. A canvas saved
  // while either was on it opens without them — the panels say the same thing,
  // and they hold nothing of the user's that could be rescued. Their ids fall
  // out of `autoPlaced` and any edge drawn to them below.
  .filter((n) => !['personality', 'summary', 'pulse', 'usage'].includes(n.type as string))

  const ids = new Set(nodes.map((n) => n.id))

  const restored = nodes.map((n) => {
    const node = {
      id: n.id,
      type: n.type,
      position: n.position ?? { x: 0, y: 0 },
      ...(n.width ? { width: n.width } : {}),
      ...(n.height ? { height: n.height } : {}),
      data: n.data,
    } as GtNode
    // Agent nodes have carried two different sizing regimes: resizable
    // transcript windows, then one fixed label size. File chips carried a
    // third, a fixed 196×38 box. All three now size themselves — an agent from
    // its density, a chip from its own name — so a saved box of any vintage is
    // a box the node would not choose. Drop it and let them measure.
    if (node.type === 'session' || node.type === 'file') {
      delete node.width
      delete node.height
    }
    // The Changes module was called Landing. A canvas saved under the old
    // name carries `landing`, which no node type answers to any more, so it
    // would restore as a blank box; the id it holds is renamed with it.
    if ((node.type as string) === 'landing') {
      node.type = 'changes'
      const d = node.data as { landingId?: string; changesId?: string } | undefined
      if (d && !d.changesId && d.landingId) node.data = { changesId: d.landingId } as GtNode['data']
    }
    // Belt and braces: files written before settleSession existed, or edited
    // by hand, must still open in a usable state.
    if (node.type === 'session') node.data = settleSession(node.data)
    return node
  })

  return {
    nodes: restored,
    // A canvas saved while the invariant was broken — or one whose `cwd`
    // folder node has since been dropped above — opens with an heir promoted
    // rather than a session that silently can't be sent to.
    edges: reconcileFolderEdges(
      (data?.edges ?? [])
        .filter((e) => !!e && e.type !== 'call')
        .filter((e) => ids.has(e.source) && ids.has(e.target)),
      restored,
    ),
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
    // Absent in canvases saved before planning existed. On is the default for
    // those too: the mode is about what the *next* turn does, and a canvas
    // that opens ready to run unattended is the surprise, not the other way.
    planning: data?.planning ?? true,
    // Off for a canvas saved before worktrees existed: turning it on creates
    // directories, and a file written by an older build never consented to
    // that.
    isolateSpawns: data?.isolateSpawns === true,
    checkCommand: typeof data?.checkCommand === 'string' ? data.checkCommand : '',
    // Strings only, and nothing this build cannot enforce: a rule it does not
    // recognise would read as a guard that is on while nothing checks it.
    guards: Array.isArray(data?.guards)
      ? data.guards.filter((g): g is string => typeof g === 'string')
      : [],
    // Field by field, not spread wholesale: a hand-edited or older file may
    // carry a tier that is no longer offered, and a preference must never put
    // a value the pickers cannot show back into the store.
    orchestra: readOrchestra(data?.orchestra),
    // Absent in canvases saved before the panels floated; those open with
    // nothing showing, which is what a canvas that never had them looked like.
    panels: readPanels(data?.panels),
    // A canvas saved before one orchestrator could hold several jobs wrote a
    // single `plan`; it reads as a list of one. A plan from back then has no
    // id of its own either, so it is given one here rather than everywhere
    // downstream having to cope with a plan that cannot be named.
    plans: [...(data?.plans ?? []), ...(data?.plan ? [data.plan] : [])]
      .filter((p): p is Plan => !!p && Array.isArray(p.steps) && p.steps.length > 0)
      .map((p, i) => ({
        ...p,
        id: p.id || `plan_restored_${i}`,
        // A step that was mid-flight when the app closed is pending again: its
        // agent is gone with the process, and a step stuck on "running" for
        // ever is worse than one the user has to approve twice.
        steps: p.steps.map((st) =>
          st.state === 'running' ? { ...st, state: 'pending' as const } : st,
        ),
      })),
  }
}
