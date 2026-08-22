import { createContext, useContext, useRef, useSyncExternalStore } from 'react'
import { useStore as useZustandStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import {
  clearSessionImages,
  dirExists,
  fileExists,
  fileStamp,
  interruptSession,
  runCheck,
  sendTurn,
  terminalClose,
  worktreeAdd,
  worktreeRemove,
  writeNote,
} from './bridge'
import { forgetEmulator } from './terminals'
import { digest, readShared } from './filecache'
import { lastSaid } from './asking'
import { freshFor } from './sharedcontext'
import { attachableImage } from './filekind'
import { carryBlock, COMPACT_PROMPT, noteFile, noteName } from './compact'
import { handBack, parseReport, REPORT_INSTRUCTION, reportBlock } from './report'
import { looksLikeQuestion } from './asking'
import { boxOf, FILE_SIZE, findFreeSpot, layoutCanvas, SESSION_SIZE, sizeOf } from './layout'
import { parsePersonaDefinitions } from './persona-parse'
import { choreBlock, looksLikeChore } from './chore'
import {
  checkShape,
  fansOut,
  MAX_FANOUT,
  parsePattern,
  patternBlock,
  type PatternId,
} from './patterns'
import {
  findStep,
  insertStep,
  MAX_PLAN_STEPS,
  MAX_PLANS,
  nextStep,
  parsePlan,
  planLive,
  planOfReply,
  stepReady,
  withPlan,
} from './plan'
import { headlineOf, summarizeTurn } from './summary'
import type { Density } from './density'
import { isBellKind } from './pulse'
import {
  dedupeByName,
  loadLibrary,
  saveLibrary,
  STARTER_PERSONAS,
  type Persona,
} from './library'
import {
  DEFAULT_PANELS,
  DEFAULT_ORCHESTRA,
  MODEL_OPTIONS,
  MODEL_TIERS,
  PROVIDER_LABEL,
} from './types'
import type {
  AgentEvent,
  ContextEntry,
  Effort,
  FileNodeData,
  FolderNodeData,
  McpNodeData,
  McpServer,
  McpToolNodeData,
  TerminalNodeData,
  Message,
  ModelOption,
  OrchestraPrefs,
  Permission,
  Panels,
  PanelKey,
  Plan,
  PlanStep,
  Provider,
  ProviderStatus,
  ChangesNodeData,
  RightTab,
  SessionNodeData,
  SkillNodeData,
  SkillTrigger,
  Notification,
  NotificationKind,
} from './types'

export type CanvasDialog = 'open' | 'save-as' | 'rules'

/**
 * A message that arrived while its session was busy. Images ride along with
 * the text: they are already on disk by then, and dropping them would send a
 * question about a screenshot with no screenshot.
 */
export type QueuedTurn = { text: string; images: string[] }

export type GtNode =
  | (Node<SessionNodeData> & { type: 'session' })
  | (Node<SkillNodeData> & { type: 'skill' })
  | (Node<FolderNodeData> & { type: 'folder' })
  | (Node<FileNodeData> & { type: 'file' })
  | (Node<McpNodeData> & { type: 'mcp' })
  | (Node<McpToolNodeData> & { type: 'mcptool' })
  | (Node<ChangesNodeData> & { type: 'changes' })
  | (Node<TerminalNodeData> & { type: 'terminal' })

const uid = () => Math.random().toString(36).slice(2, 10)

/** Cap on how much shared context we inject into a single turn. */
const CONTEXT_BUDGET_CHARS = 2400
/** Cap on injected file content, per turn, across all attached file nodes. */
const FILE_BUDGET_CHARS = 12000
/** A busy agent can touch hundreds of files; the canvas must stay readable. */
const MAX_AUTO_FILES_PER_SESSION = 10
/**
 * Turn summaries kept per session. A long conversation would otherwise bury
 * the canvas, so the oldest are dropped rather than the newest withheld — the
 * turn that just finished is the one worth looking at.
 */
/** Kept in the feed before the oldest fall off. */
const MAX_NOTIFICATIONS = 200

export type State = {
  nodes: GtNode[]
  edges: Edge[]
  providers: ProviderStatus[]
  cwd: string
  bus: ContextEntry[]
  /** Per-target record of which context entries have already been delivered. */
  delivered: Record<string, Set<string>>
  selectedId: string | null
  /** Absolute path of the file open in the viewer, if any. */
  openFilePath: string | null

  /** The saved canvas this graph belongs to, or null if never saved. */
  canvasId: string | null
  canvasName: string
  canvasSavedAt: number | null
  /** Set whenever the graph has moved on from what's on disk. */
  canvasDirty: boolean
  canvasError: string | null
  /** Which canvas overlay is up, if any. */
  canvasDialog: CanvasDialog | null
  /**
   * Rules the user set for this whole canvas. Injected into the opening turn
   * of every agent spawned on it, orchestrator included.
   */
  globalRules: string

  /** Personas that outlive the canvas. Loaded from disk at startup. */
  library: Persona[]
  /** The rail's drawer: the canvas list, or the decisions taken on this one. */
  libraryOpen: boolean
  rightTab: RightTab
  /**
   * The floating readouts, and how each of them is showing. Saved with the
   * canvas rather than with the window: which of them you keep open is a fact
   * about the work on this canvas, not about this machine.
   */
  panels: Panels
  /** Session node the chat panel is pointed at. Falls back to the orchestrator. */
  chatTarget: string | null
  /**
   * Text another surface wants typed into the chatbox.
   *
   * The draft itself belongs to the composer — it is keyed to the session, and
   * pulling it into the store would mean every keystroke re-rendering the
   * canvas. This is a one-shot handoff: a panel leaves a skill's name here,
   * the composer types it and clears it.
   */
  composerSeed: string | null

  /**
   * Which models the user wants this canvas's orchestrator reaching for. Read
   * by `orchestratorBlock`; set from the chatbox.
   */
  orchestra: OrchestraPrefs
  /** Partial so one control moves one field — the rest keep their setting. */
  setOrchestra: (patch: Partial<OrchestraPrefs>) => void

  onNodesChange: (c: NodeChange<GtNode>[]) => void
  onEdgesChange: (c: EdgeChange[]) => void
  onConnect: (c: Connection) => void

  setProviders: (p: ProviderStatus[]) => void
  setCwd: (c: string) => void
  select: (id: string | null) => void
  /**
   * Select exactly one node, the way a click on it would.
   *
   * Distinct from `select`, which records *which* node is the subject of the
   * app's own bookkeeping. This writes React Flow's own `selected` flag, which
   * is what draws the selection ring and what brings up a node's inspector —
   * so it is the one to use when the app wants to show you a node rather than
   * merely remember it.
   */
  focusNode: (id: string) => void
  openFile: (path: string | null) => void

  addSession: (provider: Provider, pos: { x: number; y: number }) => string
  /** Start an agent configured by a library persona. */
  addSessionFromPersona: (persona: Persona, pos: { x: number; y: number }) => string
  addSkill: (pos: { x: number; y: number }, seed?: Partial<SkillNodeData>) => string
  addFolder: (path: string, pos: { x: number; y: number }, seed?: Partial<FolderNodeData>) => string
  /**
   * Put a worktree on the canvas, before it exists.
   *
   * The node lands where you asked for it and takes the branch name there;
   * `createWorktree` is what cuts the checkout. Returns the node's id, or null
   * when there is no repository on the canvas to branch from.
   */
  addWorktree: (pos: { x: number; y: number }) => string | null
  /** Cut the checkout a draft worktree node is standing in for. */
  createWorktree: (nodeId: string, name: string) => Promise<{ error: string } | null>
  /**
   * Delete a worktree's checkout from disk, and the node with it.
   *
   * Refused by git while the checkout still holds uncommitted work, which is
   * the safety: that is where an agent's last hour lives.
   */
  removeWorktree: (nodeId: string) => Promise<{ error: string } | null>
  /**
   * Give a session another folder to reach. Reuses a folder node already on
   * the canvas for that path rather than adding a second one for the same
   * directory. Returns the folder node's id, or null when it was already wired
   * into this session.
   */
  attachFolder: (sessionNodeId: string, path: string, seed?: Partial<FolderNodeData>) => string | null
  /** Unwire a folder from a session. The node stays — it may feed others. */
  detachFolder: (sessionNodeId: string, folderNodeId: string) => void
  /** Make an attached folder the working directory, demoting the incumbent. */
  setPrimaryFolder: (sessionNodeId: string, folderNodeId: string) => void
  /**
   * Give an agent its own checkout of the repository it is working in.
   *
   * Returns the branch it landed on, or an error string to show. Resolves
   * nothing else: the worktree arrives on the canvas as an ordinary folder
   * node, wired in as this agent's working directory, because it is an
   * ordinary directory that now exists.
   */
  isolateSession: (sessionNodeId: string) => Promise<{ branch: string } | { error: string }>
  addFile: (path: string, pos: { x: number; y: number }, origin?: 'user' | 'agent') => string
  addMcp: (server: McpServer, pos: { x: number; y: number }) => string
  /** Show a floating panel, or put it away again. */
  togglePanel: (key: PanelKey) => void
  /** Fold a panel down to its header, or open it back up. */
  setPanelMinimized: (key: PanelKey, minimized: boolean) => void
  /**
   * Put a panel in front of the user, whatever state it was in. For the places
   * that answer a question with a panel — the title bar's readouts — where
   * revealing a minimized header would not have answered it.
   */
  showPanel: (key: PanelKey) => void
  /**
   * Put a note on the shared board by hand.
   *
   * Delivered to every agent on its next turn, exactly like a summary an agent
   * wrote — the fact everyone needs is as often yours as an agent's.
   */
  postNote: (body: string) => void
  /** Take an entry off the board. Nothing is un-delivered by this. */
  removeNote: (id: string) => void
  /** The Changes module. One per canvas, for the same reason as the others. */
  addChanges: (pos: { x: number; y: number }) => string
  /**
   * A shell on the canvas. Several are fine — one per thing you are watching —
   * unlike the Changes module, which has nothing to distinguish two copies.
   */
  addTerminal: (pos: { x: number; y: number }) => string
  /**
   * Update what a terminal node says about its shell.
   *
   * Live state only — whether a shell is up, and how the last one ended. None
   * of it is persisted: the process dies with the app, and a restored node
   * claiming a running shell would be wrong about the one thing it is for.
   */
  patchTerminal: (nodeId: string, patch: Partial<TerminalNodeData>) => void
  /**
   * Pin how much of an agent its node shows, or hand it back to the zoom.
   *
   * `undefined` is the release, not a fourth density — a node that has been
   * released follows the zoom again, which is the state every node starts in.
   */
  setDensity: (nodeId: string, density: Density | undefined) => void
  initLibrary: () => Promise<void>
  setLibrary: (l: Persona[]) => Promise<void>
  toggleLibrary: () => void
  /** Arrange every node by its role in the graph. */
  tidy: (all?: boolean) => void
  autoTidy: boolean
  /**
   * Nodes an agent placed. Only these are auto-arranged; anything the user
   * added or moved stays exactly where they put it.
   */
  autoPlaced: Set<string>
  /** What happened while you weren't looking, newest first. */
  notifications: Notification[]
  markNotificationsRead: () => void
  clearNotifications: () => void
  /** Messages typed at a session that was mid-turn, waiting their turn. */
  queued: Record<string, QueuedTurn[]>
  /**
   * Sessions whose in-flight turn is being abandoned and re-run, keyed to the
   * prompt to replay. Set when a setting that only takes effect at turn start
   * — effort — changes mid-turn.
   */
  restarting: Record<string, QueuedTurn>
  /** Hand a node back to the user — called when they drag it. */
  claimNode: (id: string) => void
  toggleAutoTidy: () => void

  /**
   * Planning mode. On, an orchestrator proposes the work and nothing runs
   * until the user approves it; off, it spawns as soon as it decides to.
   */
  planning: boolean
  /**
   * Whether a new agent gets its own checkout of the repository.
   *
   * Off by default: a canvas with one agent on it has nothing to isolate from,
   * and a worktree it did not ask for is a directory to explain. On, every
   * agent spawned from here works alone — which is the only way a squad's
   * diffs stay attributable.
   */
  isolateSpawns: boolean
  togglePlanning: () => void
  /** Turn worktree-per-agent on or off for agents spawned from now on. */
  setIsolateSpawns: (on: boolean) => void
  /**
   * The command that decides whether this canvas's work is any good.
   *
   * The project's own — `bun run test`, `cargo test`, `make check` — run in
   * the agent's working directory after it writes something. Empty means no
   * verification, which is where every canvas starts and what every canvas did
   * before this existed.
   */
  checkCommand: string
  setCheckCommand: (command: string) => void
  /**
   * Operations this canvas refuses to let an agent take unasked.
   *
   * Ids from `guard_rules` — `push`, `discard`, `rewrite`. Enforced by a shim
   * on the agent's PATH rather than by asking the provider nicely: see
   * `guard.rs`. Empty is the default and means nothing is held back.
   */
  guards: string[]
  setGuards: (guards: string[]) => void
  /**
   * Run the check against one agent's work now.
   *
   * Manual and automatic land here, so a verdict means the same thing however
   * it was asked for.
   */
  runCheckFor: (nodeId: string) => Promise<void>
  /**
   * Recycle an agent's context window into a handover note on the canvas.
   *
   * Asks the agent to write the note, saves it, puts it on the canvas wired to
   * the agent, then drops the provider session so the next turn starts in a
   * fresh window carrying only that note. Returns an error string when the
   * note could not be written — nothing is dropped in that case, because a
   * window emptied without a note is the failure this exists to prevent.
   */
  compact: (nodeId: string) => Promise<{ error: string } | null>
  /**
   * The plans waiting on the user, oldest first.
   *
   * More than one because an orchestrator can be fixing two things at once,
   * and the second fix is not the tail of the first. They are held flat rather
   * than grouped by agent because that is how they are drawn, saved and
   * cleared — the orchestrator each belongs to is on the plan itself.
   */
  plans: Plan[]
  /**
   * Put a step of your own into one plan, before the step now at `at`.
   *
   * A plan is a proposal, and a proposal you cannot amend is a yes/no question
   * wearing a list's clothes — the review step you want before the implementer
   * had no way in except asking the orchestrator to write the plan again.
   * Returns the new step's id, or null when the plan is already at its limit.
   */
  addPlanStep: (planId: string, at: number) => string | null
  /** Say what a step is. Both fields start empty on a step you added. */
  editPlanStep: (stepId: string, patch: { persona?: string; task?: string }) => void
  removePlanStep: (stepId: string) => void
  discardPlan: (planId: string) => void
  /** Run one step now. Resolves when the agent it spawns has finished. */
  approvePlanStep: (stepId: string) => Promise<void>
  /** Run every step of one plan that is still pending, in order. */
  approvePlan: (planId: string) => Promise<void>
  updateSkill: (nodeId: string, patch: Partial<SkillNodeData>) => void
  removeNode: (id: string) => void
  /**
   * Empty this canvas without leaving it.
   *
   * Folders stay: they are the directories the canvas is about rather than
   * work done on it, and clearing to start again means starting again *here*.
   * Everything else goes through `removeNode`, so a cleared session drops its
   * pasted images and a cleared terminal closes its shell — the same teardown
   * deleting one by hand has always done.
   */
  clearCanvas: () => void
  renameSession: (nodeId: string, name: string) => void
  setPermission: (nodeId: string, permission: Permission) => void
  setModel: (nodeId: string, model?: string) => void
  /** Undefined is "unset" — fall back to the provider's own default. */
  setEffort: (nodeId: string, effort?: Effort) => void
  /** This agent's standing brief, prepended to every turn. */
  setInstructions: (nodeId: string, instructions: string) => void
  setRightTab: (t: RightTab) => void
  setChatTarget: (nodeId: string | null) => void
  /** Ask the chatbox to start a message with this text. */
  setComposerDraft: (text: string) => void
  /** Called by the composer once it has taken the seed. */
  clearComposerSeed: () => void

  setCanvasDialog: (d: CanvasDialog | null) => void
  setGlobalRules: (rules: string) => void

  send: (nodeId: string, text: string, images?: string[]) => Promise<void>
  interrupt: (nodeId: string) => Promise<void>
  applyEvent: (sessionId: string, ev: AgentEvent) => void
}

// ── helpers ────────────────────────────────────────────────────────────

const isSession = (n: GtNode): n is GtNode & { type: 'session' } => n.type === 'session'

/**
 * Strip the exchange a restarted turn was in the middle of: the half-written
 * reply, and the prompt above it that is about to be sent again. Without the
 * second half you would read your own message twice with a truncated answer
 * wedged between them.
 */
function dropAbandonedTurn(messages: Message[]): Message[] {
  const out = [...messages]
  if (out.at(-1)?.role === 'assistant') out.pop()
  if (out.at(-1)?.role === 'user') out.pop()
  return out
}
const isSkill = (n: GtNode): n is GtNode & { type: 'skill' } => n.type === 'skill'
const isFolder = (n: GtNode): n is GtNode & { type: 'folder' } => n.type === 'folder'
const isFile = (n: GtNode): n is GtNode & { type: 'file' } => n.type === 'file'
const isMcp = (n: GtNode): n is GtNode & { type: 'mcp' } => n.type === 'mcp'
const isMcpTool = (n: GtNode): n is GtNode & { type: 'mcptool' } => n.type === 'mcptool'
export const isTerminal = (n: GtNode): n is GtNode & { type: 'terminal' } =>
  n.type === 'terminal'

/** `mcp__flowiki__search` → { server: 'flowiki', tool: 'search' } */
export function parseMcpTool(name: string): { server: string; tool: string } | null {
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/)
  return m ? { server: m[1], tool: m[2] } : null
}

/** A folder a session reaches, and in which capacity. */
export type FolderRoot = {
  nodeId: string
  path: string
  /** True for the one `cwd` edge — the process's actual working directory. */
  primary: boolean
  missing: boolean
}

/**
 * Every folder wired into a session, primary first.
 *
 * A session's folders are carried entirely by edge *type*: exactly one `cwd`
 * edge is the working directory, and any number of `attach` edges are extra
 * roots it may read from. Nothing about this lives in node data, so promoting
 * an extra root to primary is a retype rather than a field to keep in sync.
 *
 * Missing folders are included and flagged rather than dropped — a folder that
 * has gone away must be visible so the user can fix or detach it.
 */
export function folderRootsFor(
  nodes: GtNode[],
  edges: Edge[],
  sessionNodeId: string,
): FolderRoot[] {
  const roots = edges
    .filter((e) => e.target === sessionNodeId && (e.type === 'cwd' || e.type === 'attach'))
    .map((e) => ({ edge: e, node: nodes.find((n) => n.id === e.source) }))
    // A draft worktree is a name being typed, not a directory: wiring one in
    // must not hand an agent an empty path to run in.
    .filter(
      (x): x is { edge: Edge; node: GtNode & { type: 'folder' } } =>
        !!x.node && isFolder(x.node) && !x.node.data.draft,
    )
    .map(({ edge, node }) => ({
      nodeId: node.id,
      path: node.data.path,
      primary: edge.type === 'cwd',
      missing: !!node.data.missing,
    }))
  // Primary first; the rest keep the order their edges were created in, which
  // is the order the user wired them.
  return [...roots.filter((r) => r.primary), ...roots.filter((r) => !r.primary)]
}

/**
 * Two paths naming the same directory, as far as we can tell from a string.
 *
 * Trailing slashes are the difference the picker and hand-typed paths actually
 * produce, so those go. Symlinks and macOS's case-insensitive filesystem can
 * still hide a duplicate — resolving those means canonicalising on the Rust
 * side, which is not something the store can do synchronously.
 */
export function samePath(a: string, b: string): boolean {
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  return trim(a) === trim(b)
}

/**
 * Give every session with folder edges exactly one `cwd`.
 *
 * The invariant used to be maintained only where folders were detached from
 * the folder menu, which left three other ways to break it: deleting a folder
 * node, selecting the `cwd` edge and pressing delete, and opening a canvas
 * saved while broken. A session with `attach` edges and no `cwd` cannot be
 * sent to at all, while every folder UI still shows it wired in — so this runs
 * after each edge mutation rather than at the one call site that noticed.
 *
 * Returns the input array untouched when nothing needed fixing, so the common
 * case costs no re-render.
 */
export function reconcileFolderEdges(edges: Edge[], nodes: GtNode[]): Edge[] {
  const folderIds = new Set(nodes.filter(isFolder).map((n) => n.id))
  const bySession = new Map<string, Edge[]>()
  for (const e of edges) {
    if ((e.type !== 'cwd' && e.type !== 'attach') || !folderIds.has(e.source)) continue
    const list = bySession.get(e.target)
    if (list) list.push(e)
    else bySession.set(e.target, [e])
  }

  const retype = new Map<string, 'cwd' | 'attach'>()
  for (const list of bySession.values()) {
    // Oldest survivor wins, edge order being wiring order — the same
    // first-wins rule `onConnect` uses when assigning the first edge's type.
    const keep = list.find((e) => e.type === 'cwd') ?? list[0]
    for (const e of list) {
      const want = e === keep ? 'cwd' : 'attach'
      if (e.type !== want) retype.set(e.id, want)
    }
  }
  if (!retype.size) return edges
  return edges.map((e) => {
    const want = retype.get(e.id)
    return want ? { ...e, type: want } : e
  })
}

const cwdSourceFor = (edges: Edge[], sessionNodeId: string) =>
  edges.find((e) => e.target === sessionNodeId && e.type === 'cwd')?.source

/**
 * Reconcile after an edge mutation, and tell any session whose working
 * directory changed under it. A promotion the user didn't ask for is exactly
 * the kind of thing that has to be said out loud in the transcript.
 */
function reconcileFolders(
  nodes: GtNode[],
  prevEdges: Edge[],
  nextEdges: Edge[],
): { nodes: GtNode[]; edges: Edge[] } {
  const edges = reconcileFolderEdges(nextEdges, nodes)
  if (edges === nextEdges) return { nodes, edges }

  const promoted = new Map<string, string>()
  for (const e of edges) {
    if (e.type !== 'cwd') continue
    const before = cwdSourceFor(prevEdges, e.target)
    // Only an inherited primary is news; a session gaining its first folder
    // already knows, having just been wired to one.
    if (before && before !== e.source) promoted.set(e.target, e.source)
  }
  if (!promoted.size) return { nodes, edges }

  return {
    edges,
    nodes: nodes.map((n) => {
      const heirId = promoted.get(n.id)
      if (!heirId || !isSession(n)) return n
      const heir = nodes.find((f) => f.id === heirId)
      return {
        ...n,
        data: {
          ...n.data,
          messages: [
            ...n.data.messages,
            {
              id: uid(),
              role: 'system' as const,
              text: `Working directory is now ${
                heir && isFolder(heir) ? heir.data.path : 'the remaining folder'
              }.`,
              tools: [],
            },
          ],
        },
      }
    }) as GtNode[],
  }
}

/**
 * Folder nodes a session may search. The graph is the boundary here as
 * everywhere else: a directory that isn't on the canvas cannot be reached,
 * whatever the session's cwd happens to be.
 */
export function searchRootsFor(nodes: GtNode[], edges: Edge[], sessionNodeId: string): string[] {
  return folderRootsFor(nodes, edges, sessionNodeId)
    .filter((r) => !r.missing)
    .map((r) => r.path)
}

/**
 * The folders this agent can reach, as a block to lead its opening turn with.
 *
 * A process has exactly one working directory — `.current_dir()` takes one
 * path — so extra roots reach the agent as *context*: absolute paths it has
 * been told about and may read from. Whether it is actually permitted to is
 * the provider's decision, not something this block grants.
 *
 * One folder produces nothing: the agent is already sitting in it, and saying
 * so adds a block that carries no information.
 */
export function canvasFoldersBlock(roots: FolderRoot[]): string {
  const live = roots.filter((r) => !r.missing)
  if (live.length < 2) return ''
  const lines = live.map((r) =>
    r.primary ? `${r.path} (working directory)` : r.path,
  )
  return [
    '<canvas-folders>',
    'This canvas gives you more than one folder. Your working directory is the',
    'first; the others are reachable by absolute path, not by relative path.',
    '',
    ...lines,
    '</canvas-folders>',
  ].join('\n')
}

/**
 * What the agent has been told, as a value that doesn't care about order.
 *
 * Comparing the rendered block instead would call a detach-then-reattach of
 * the same directory a change, because it reorders the extras — and the block
 * promises to go out only when the set really changed.
 */
export function folderSetKey(roots: FolderRoot[]): string {
  const live = roots.filter((r) => !r.missing)
  const primary = live.find((r) => r.primary)
  return [
    primary?.path ?? '',
    ...live.filter((r) => !r.primary).map((r) => r.path).sort(),
  ].join('\n')
}

/**
 * What to tell an agent that has just dropped back to a single folder.
 *
 * `canvasFoldersBlock` is empty in that case, and saying nothing would leave
 * the extra roots it was handed earlier sitting unretracted in its history —
 * paths it would go on reading from.
 */
export function canvasFoldersEndedBlock(roots: FolderRoot[]): string {
  const primary = roots.find((r) => r.primary && !r.missing)
  return [
    '<canvas-folders>',
    primary
      ? `You now have one folder: ${primary.path}, your working directory.`
      : 'You now have no folder attached.',
    'Any other folders named earlier in this conversation are no longer',
    'reachable — do not read from them.',
    '</canvas-folders>',
  ].join('\n')
}

/** File nodes already on the canvas, mentionable without any search. */
export function canvasFilesFor(nodes: GtNode[]): { path: string; name: string }[] {
  return nodes
    .filter((n): n is GtNode & { type: 'file' } => n.type === 'file')
    .map((n) => ({ path: n.data.path, name: basename(n.data.path) }))
}

/**
 * The canvas's rules, as a block to lead an agent's opening turn with.
 *
 * Empty rules produce nothing at all: an empty pair of tags reads as an
 * instruction to follow no rules, which is not what a blank field means.
 */
export function globalRulesBlock(rules: string): string {
  const body = rules.trim()
  return body ? `<canvas-global-rules>\n${body}\n</canvas-global-rules>` : ''
}

/** MCP servers wired into a session — what gets passed at spawn. */
export function mcpFor(nodes: GtNode[], edges: Edge[], sessionNodeId: string): McpServer[] {
  return edges
    .filter((e) => e.target === sessionNodeId && e.type === 'attach')
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is GtNode & { type: 'mcp' } => !!n && isMcp(n))
    .map((n) => ({
      name: n.data.name,
      transport: n.data.transport,
      source: n.data.source,
      ...(n.data.command ? { command: n.data.command } : {}),
      ...(n.data.args?.length ? { args: n.data.args } : {}),
      ...(n.data.url ? { url: n.data.url } : {}),
    }))
}

/**
 * What a session may spawn: every persona in the library.
 *
 * Personas used to also come from personality nodes wired into the session,
 * which meant a canvas needed one node per role before an orchestrator could
 * use it. The library is available everywhere without wiring — a persona you
 * defined once should work on any canvas — so the nodes only ever added
 * clutter and a second place for the same settings to drift.
 */
export function rosterFor(library: Persona[]): Persona[] {
  return library
}

/** One persona as the orchestrator reads it when routing. */
export const rosterLine = (p: Persona) =>
  `- ${p.name} (${p.provider}${p.model ? `/${p.model}` : ''}${
    p.effort ? `, ${p.effort} effort` : ''
  }, ${p.permission}) — ${p.description}`

/**
 * The roster as a value that changes only when the routing would.
 *
 * Comparing the rendered list would do, but this says what the comparison is
 * actually for: everything the orchestrator uses to choose a persona, and
 * nothing else. A persona's id or its position in the library moving is not a
 * reason to spend a turn's tokens telling every orchestrator about it.
 */
export function rosterKey(roster: Persona[]): string {
  return roster.map(rosterLine).sort().join('\n')
}

/**
 * A roster that has changed since the orchestrator was last told about it.
 *
 * The full protocol block is thousands of characters and the agent already
 * has it in history; the personas are the only part of it that moves, so
 * when one is added or edited that is the only part that goes again.
 */
export function rosterUpdateBlock(roster: Persona[]): string {
  return [
    '<canvastrator-personas>',
    'The persona library has changed. This is now the full list you may',
    'instantiate — it replaces the one you were given earlier:',
    '',
    roster.length ? roster.map(rosterLine).join('\n') : '(none)',
    '</canvastrator-personas>',
  ].join('\n')
}

/**
 * The user's standing model preference for this canvas, as a block.
 *
 * Empty when nothing is set, and the caller drops empty parts — a canvas with
 * no preference must send the orchestrator exactly what it sent before this
 * existed, rather than a paragraph saying there is nothing to say.
 *
 * Worded as a default rather than a rule: the tier mapping above is about what
 * a model is *good at*, and an orchestrator that obeyed a preference into
 * giving a light model an architecture task would be following the letter of
 * this and losing the point of both.
 */
export function orchestraBlock(prefs: OrchestraPrefs): string {
  const lines = [
    ...(prefs.provider ? [`- Spawn on ${prefs.provider} unless the work needs another provider.`] : []),
    ...MODEL_TIERS.filter((t) => prefs[t]).map(
      (t) => `- For ${TIER_USE[t]}, use ${prefs[t]}.`,
    ),
  ]
  if (!lines.length) return ''
  return [
    '<canvastrator-model-preference>',
    "The user has said which models this canvas should reach for. Treat these as the default choice for a persona you invent, in place of picking freely from the mapping above:",
    ...lines,
    '',
    'Depart from one only when the work plainly needs a different model, and say so in the same reply when you do.',
    '</canvastrator-model-preference>',
  ].join('\n')
}

/**
 * The preference as a watermark. Sent-once blocks are re-sent when their key
 * changes, so a preference the user edits mid-conversation reaches an agent
 * that has already had its brief.
 */
export const orchestraKey = (prefs: OrchestraPrefs): string =>
  [prefs.provider, ...MODEL_TIERS.map((t) => prefs[t])].map((v) => v ?? '').join('|')

/**
 * The orchestrator's standing brief: what it is for, and how to say what it
 * wants done.
 *
 * Sent once per session, and again only when planning mode flips — the
 * protocol is the half of this that changes with the mode, and it is not
 * separable from the rest without leaving the example contradicting it. A
 * roster that changes on its own goes as a `rosterUpdateBlock` instead, which
 * is a tenth of the size.
 */
export function orchestratorBlock(
  roster: Persona[],
  planning: boolean,
  orchestra: OrchestraPrefs = DEFAULT_ORCHESTRA,
): string {
  const list = roster.length ? roster.map(rosterLine).join('\n') : '(none yet)'
  const preference = orchestraBlock(orchestra)

  // Planning mode changes what the orchestrator is for: it proposes the
  // whole job and the user approves it, rather than starting the first
  // piece of work it thinks of. The gate is enforced when the turn ends,
  // so this is here to make the reply the right shape, not to hold the
  // line on its own.
  const protocol = planning
    ? [
        'Canvastrator is in PLANNING MODE: you do not start work, you propose it. Set out the whole job as one line per step, in the order the steps should run:',
        'PLAN <persona-name>: <the task, stated fully enough to act on without further context>',
        '',
        'A step ends at the end of its line, so keep each task on one line however long it is. Put any commentary of your own before the first PLAN line.',
        '',
        'Nothing runs until the user approves it, and they may edit a task, drop a step, or approve steps one at a time. So plan the whole job rather than only the first move, and make each step say enough to be judged on its own. Each step that runs reports back to you before the next one starts; if what comes back changes the plan, write new PLAN lines then.',
        '',
      ]
    : [
        'To run one, put this in your reply:',
        'SPAWN <persona-name>: <the task, stated fully enough to act on without further context>',
        '',
        'The task may run over several paragraphs — everything after the colon belongs to it, to the end of your reply. So put any commentary of your own BEFORE the SPAWN line, never after it.',
        '',
      ]

  return [
    '<canvastrator-orchestrator>',
    'You are the orchestrator of a canvas of agents. Your job is to route work, not to perform it.',
    '',
    'Do the work yourself ONLY when it is trivial: a direct question about this conversation, a one-line clarification, or deciding what to do next. Anything that involves reading a codebase, writing or changing files, running commands, designing, reviewing, or research goes to a specialist — even when you could do it. A task you complete yourself is a task the user cannot see, re-run, or reassign.',
    '',
    patternBlock(planning),
    '',
    'Available personas:',
    list,
    '',
    ...protocol,
    `If none of the available personas is a good fit, INVENT ONE FIRST. Do not force a bad fit, and do not fall back to doing it yourself. Define it with a fenced block, then ${planning ? 'use it in a step' : 'spawn it'} in the same reply:`,
    '',
    '```canvastrator-persona',
    'name: api-designer',
    'provider: claude',
    `model: ${EXAMPLE_CLAUDE_MODEL}`,
    'effort: high',
    'permission: plan',
    'description: Designs HTTP APIs and data contracts. Use before implementing an endpoint.',
    '---',
    'You design APIs. Produce the contract — routes, payloads, status codes, error shapes — and the reasoning behind it. Do not write implementation code.',
    '```',
    `${planning ? 'PLAN' : 'SPAWN'} api-designer: Design the /sessions endpoint for …`,
    '',
    'Choosing the fields:',
    '- provider: claude, codex, or opencode.',
    `- model: match the model to the work, using the mapping below — it is explicit, so never infer rank from the order of a list. Use one of the ids the chosen provider takes, or omit it to take the provider default.\n${MODEL_GUIDE}`,
    '- effort: how hard it should think. low for mechanical passes, medium for ordinary implementation and review, high for architecture and hard debugging, xhigh or max only for genuinely difficult problems — they are slow and expensive. Omit it and the persona runs at medium.',
    '- permission: plan for anything read-only (review, research, design), auto when it must edit files or run commands, full only when it genuinely needs an unsandboxed machine.',
    '- description: when a future orchestrator should reach for this. It is the only thing routing sees, so make it specific.',
    '',
    // Dropped by the join when empty, so a canvas with no preference set reads
    // exactly as it did before this existed.
    ...(preference ? [preference, ''] : []),
    'A persona you define is saved to the user\'s library and reusable on every canvas, so define it as a lasting role, not a one-off errand. Name it for the role, never for the specific task.',
    '',
    `If this turn carries a <canvas-global-rules> block, those rules are the user's and they bind you. They also bind everyone you spawn: Canvastrator gives each new agent the same block, and you must restate anything task-specific from it in the ${planning ? 'PLAN' : 'SPAWN'} text you write.`,
    '</canvastrator-orchestrator>',
  ].join('\n')
}

/**
 * How to read a conversation whose setup does not repeat itself.
 *
 * Canvastrator sends each standing block — the brief, the folders, the
 * personas, an attached file — once, and again only when it changes, because
 * the provider is replaying the conversation and the agent is already holding
 * them. Without being told that, an agent has every reason to read the
 * disappearance of its folder block as the folders being withdrawn, and to
 * start asking where its files went.
 */
export const standingBlock = () =>
  [
    '<canvastrator-standing>',
    'Every block Canvastrator sends you stays in force for the whole conversation.',
    'They are sent once, when they are new or when they change — not repeated every',
    'turn. A block missing from a later turn has not been withdrawn; it still',
    'applies. Only a block that says it replaces an earlier one has changed anything.',
    '</canvastrator-standing>',
  ].join('\n')

/** The agents an orchestrator may hand a task to, as a block. */
export function peersBlock(names: { name: string; provider: Provider }[]): string {
  if (!names.length) return ''
  return [
    '<canvastrator-agents>',
    'Other agents you can delegate to:',
    ...names.map((p) => `- ${p.name} (${p.provider})`),
    '',
    'To delegate, put a line in your reply of exactly this form:',
    'DELEGATE <agent-name>: <the task>',
    'Canvastrator will run it on that agent and report back. Only delegate when it genuinely helps.',
    'This list replaces any you were given earlier.',
    '</canvastrator-agents>',
  ].join('\n')
}

export const peerKey = (names: { name: string }[]) =>
  names.map((p) => p.name).sort().join('\n')

/**
 * What to tell an orchestrator whose last colleague just left the canvas.
 *
 * `peersBlock` is empty in that case, and saying nothing would leave the names
 * it was given earlier standing — it would go on addressing DELEGATE lines to
 * agents that no longer exist, which fails silently at the lookup.
 */
export const peersEndedBlock = () =>
  [
    '<canvastrator-agents>',
    'There are no other agents on this canvas now. Anyone named earlier in this',
    'conversation is gone — do not delegate to them.',
    '</canvastrator-agents>',
  ].join('\n')

/**
 * Files another agent on this canvas has already opened.
 *
 * The point of a canvas of agents is that they are working on one thing, and
 * the expensive part of that is reading: four workers pointed at the same repo
 * will each spend a turn discovering the same files. This does not hand over
 * the contents — a worker still reads what it needs, with its own judgement
 * about what matters — it hands over the map, so the reading is aimed rather
 * than exploratory.
 *
 * Only files an agent *touched* are listed. A file the user dropped on the
 * canvas is either wired into this session, in which case it arrives in full,
 * or it is not, in which case nobody has read it and there is nothing to say.
 */
export function filesKnown(
  nodes: GtNode[],
  edges: Edge[],
  sessionNodeId: string,
): { path: string; by: string[]; written: boolean }[] {
  // Attached to this session already: it gets those in full, so naming them
  // here would be telling it about files it is holding.
  const attached = new Set(
    edges
      .filter((e) => e.target === sessionNodeId && e.type === 'file')
      .map((e) => e.source),
  )

  return nodes
    .filter((n): n is GtNode & { type: 'file' } => isFile(n) && !attached.has(n.id))
    .map((f) => {
      const by = edges
        .filter((e) => e.type === 'file' && e.target === f.id && e.source !== sessionNodeId)
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter((n): n is GtNode & { type: 'session' } => !!n && isSession(n))
        .map((n) => n.data.name)
      return { path: f.data.path, by, written: !!f.data.written }
    })
    .filter((f) => f.by.length > 0)
}

/** How many files the map may name in one turn. */
const MAX_KNOWN_FILES = 40

type KnownFile = ReturnType<typeof filesKnown>[number]

/** One file's line in the map, as a value — what changes when it changes. */
export const filesKnownEntry = (f: KnownFile) =>
  `${f.path}:${f.written ? 'w' : 'r'}:${f.by.slice().sort().join(',')}`

export const filesKnownKey = (files: KnownFile[]) =>
  files.map(filesKnownEntry).sort().join('\n')

/**
 * The map, listing only what the agent has not already been told.
 *
 * A canvas of busy agents grows this list on nearly every turn, so sending
 * the whole map each time would re-send the same paths for the life of the
 * session — the exact waste this is meant to remove.
 */
export function filesKnownBlock(files: KnownFile[]): string {
  if (!files.length) return ''
  const shown = files.slice(0, MAX_KNOWN_FILES)
  const rest = files.length - shown.length
  return [
    '<canvas-files-known>',
    'Other agents on this canvas have already opened these files. This is a map,',
    'not their contents — read what you need, but start here rather than',
    'searching, and do not re-read a file just to confirm what it is.',
    '',
    ...shown.map((f) => `${f.path} — ${f.written ? 'changed' : 'read'} by ${f.by.join(', ')}`),
    ...(rest > 0 ? [`…and ${rest} more.`] : []),
    '</canvas-files-known>',
  ].join('\n')
}

export const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

/** Tool paths may be relative; a file node's identity is its absolute path. */
function absolute(path: string, cwd: string) {
  if (path.startsWith('/')) return path
  if (path.startsWith('~/')) return path
  return `${cwd.replace(/\/+$/, '')}/${path.replace(/^\.\//, '')}`
}

/**
 * A session's working directory is whichever folder node is wired into it.
 * The graph is the configuration — there is no separate cwd setting to drift.
 */
export function resolveCwd(nodes: GtNode[], edges: Edge[], sessionNodeId: string): string | null {
  const edge = edges.find((e) => e.target === sessionNodeId && e.type === 'cwd')
  if (!edge) return null
  const folder = nodes.find((n) => n.id === edge.source)
  return folder && isFolder(folder) ? folder.data.path : null
}

function findSessionNode(nodes: GtNode[], sessionId: string) {
  return nodes.find((n) => isSession(n) && n.data.sessionId === sessionId)
}

/** What each tier is for, spelled out rather than left to be inferred. */
const TIER_USE = {
  heavy: 'hard reasoning, architecture and gnarly debugging',
  mid: 'ordinary implementation and review',
  light: 'cheap mechanical passes',
} as const

const withNote = (m: ModelOption) => (m.note ? `${m.id} (${m.note})` : m.id)

/**
 * The models the orchestrator may name in a persona it invents, taken from
 * MODEL_OPTIONS so the brief can never drift from what the pickers offer.
 *
 * Grouped by tier and captioned with what that tier is for, because list
 * order carries no rank: an id sitting first is not the biggest model, and an
 * orchestrator told to pick "the biggest" would otherwise guess. Models with
 * no tier are listed separately with their note rather than dropped.
 */
const MODEL_GUIDE = (Object.keys(MODEL_OPTIONS) as Provider[])
  .map((p) => {
    const opts = MODEL_OPTIONS[p]
    const groups = (['heavy', 'mid', 'light'] as const)
      .map((t) => {
        const ms = opts.filter((m) => m.tier === t)
        return ms.length ? `${TIER_USE[t]} — ${ms.map(withNote).join(' or ')}` : null
      })
      .filter((g): g is string => g !== null)
    const untiered = opts.filter((m) => !m.tier)
    if (untiered.length)
      groups.push(
        `no place in that ordering, pick it only when its note fits the work — ${untiered
          .map(withNote)
          .join('; ')}`,
      )
    return `  - ${p}: ${groups.join('; ')}.`
  })
  .join('\n')

/**
 * The model shown in the worked example — the claude one built for reasoning.
 * Matched on the id, not the label: labels are presentation and may be
 * reworded, and a silent fall through to a different model would change the
 * example the orchestrator copies.
 */
const EXAMPLE_CLAUDE_MODEL =
  MODEL_OPTIONS.claude.find((m) => m.id === 'claude-opus-5')?.id ?? MODEL_OPTIONS.claude[0].id

/**
 * Named ahead of the factory rather than inferred from it: the runtime helpers
 * take one of these, and the factory calls them, so an inferred type would
 * chase its own tail.
 */
export type CanvasStore = StoreApi<State>

/**
 * One canvas, one store.
 *
 * The store used to *be* the open canvas: opening another one emptied this
 * object and filled it from the file, which is why switching lost whatever a
 * running agent said while you were gone — its reply arrived for a node the
 * store no longer had. Canvases are desks, not documents; you leave a job
 * running on one and go and work on another.
 *
 * So each open canvas gets an instance of this, and everything that acts on a
 * canvas is handed the instance that owns it rather than reaching for "the"
 * store. An agent's events land on the canvas its node lives on whether or not
 * that canvas is the one on screen, which is the whole point.
 */
export const createCanvasStore = (): CanvasStore =>
  createStore<State>((set, get, api) => ({
  nodes: [],
  edges: [],
  providers: [],
  cwd: '',
  bus: [],
  delivered: {},
  selectedId: null,
  openFilePath: null,

  canvasId: null,
  canvasName: 'untitled',
  canvasSavedAt: null,
  canvasDirty: false,
  canvasError: null,
  canvasDialog: null,
  globalRules: '',

  library: [],
  libraryOpen: true,
  rightTab: 'canvases',
  panels: { ...DEFAULT_PANELS },
  chatTarget: null,
  composerSeed: null,
  orchestra: { ...DEFAULT_ORCHESTRA },
  autoTidy: true,
  // On by default. An orchestrator that spawns the moment it has an idea is
  // the behaviour this exists to make optional, not the one to default to.
  planning: true,
  isolateSpawns: false,
  checkCommand: '',
  guards: [],
  plans: [],
  autoPlaced: new Set<string>(),
  notifications: [],
  queued: {},
  restarting: {},

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) as GtNode[] })),

  // Every edge mutation funnels through the same reconciliation, so deleting
  // a `cwd` edge by hand cannot leave a session wired to folders it can't use.
  onEdgesChange: (changes) =>
    set((s) => reconcileFolders(s.nodes, s.edges, applyEdgeChanges(changes, s.edges))),

  onConnect: (conn) =>
    set((s) => {
      const source = s.nodes.find((n) => n.id === conn.source)
      const target = s.nodes.find((n) => n.id === conn.target)
      if (!source || !target) return s

      // skill → session is an attach; session → session is a context edge.
      if (isSkill(source) && isSession(target)) {
        const nodes = s.nodes.map((n) =>
          n.id === target.id && isSession(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  skillIds: Array.from(new Set([...n.data.skillIds, source.data.skillId])),
                },
              }
            : n,
        ) as GtNode[]
        return {
          nodes,
          edges: addEdge({ ...conn, type: 'attach', animated: false }, s.edges),
        }
      }
      // An MCP server wired into a session grants it that server's tools.
      if (isMcp(source) && isSession(target)) {
        return { edges: addEdge({ ...conn, type: 'attach' }, s.edges) }
      }
      // The first folder wired into a session is its working directory; every
      // folder after it is an extra root it may read from. First-wins, the same
      // way `addSession` assigns the orchestrator role by ordinal — no wire
      // silently destroys an earlier one, and promotion is an explicit act.
      if (isFolder(source) && isSession(target)) {
        const already = folderRootsFor(s.nodes, s.edges, target.id)
        // By resolved path, not node id: two folder nodes may hold the same
        // directory, and granting it twice would be one root under two edges.
        if (already.some((r) => samePath(r.path, source.data.path))) return s
        const type = already.some((r) => r.primary) ? 'attach' : 'cwd'
        return { edges: addEdge({ ...conn, type }, s.edges) }
      }
      // A folder wired into a terminal is the directory its shell runs in —
      // the same rule sessions follow, and for the same reason: where a thing
      // runs is read off the graph rather than kept as a setting that can
      // disagree with it. Only one, because a shell has one cwd.
      if (isFolder(source) && isTerminal(target)) {
        const already = folderRootsFor(s.nodes, s.edges, target.id)
        if (already.length) return s
        return { edges: addEdge({ ...conn, type: 'cwd' }, s.edges) }
      }
      // A file wired into a session is context for it.
      if (isFile(source) && isSession(target)) {
        return { edges: addEdge({ ...conn, type: 'file' }, s.edges) }
      }
      if (isSession(source) && isSession(target)) {
        return { edges: addEdge({ ...conn, type: 'context' }, s.edges) }
      }
      return s
    }),

  setCanvasDialog: (canvasDialog) => set({ canvasDialog, canvasError: null }),
  setGlobalRules: (globalRules) => set({ globalRules }),

  setProviders: (providers) => set({ providers }),
  setCwd: (cwd) => set({ cwd }),
  select: (selectedId) => set({ selectedId }),

  focusNode: (id) =>
    set((s) => ({
      selectedId: id,
      nodes: s.nodes.map((n) =>
        n.selected === (n.id === id) ? n : { ...n, selected: n.id === id },
      ) as GtNode[],
    })),
  openFile: (openFilePath) => set({ openFilePath }),

  addSession: (provider, pos) => {
    const id = `node_${uid()}`
    // Deferred to a microtask, because callers rename the agent in the same
    // tick they create it — spawnChild does — and a branch named for the
    // placeholder would outlive the placeholder.
    queueMicrotask(() => void autoIsolate(api, id))
    const sessionId = `sess_${uid()}`
    const existing = get().nodes.filter(isSession).length
    const role = existing === 0 ? 'orchestrator' : 'worker'
    const node: GtNode = {
      id,
      type: 'session',
      position: pos,
      // No declared box. An agent node picks its own width from its density
      // and its height from what it has to say, and React Flow measures the
      // result — so zooming out to glance costs no store write and cannot
      // mark the canvas dirty.
      data: {
        sessionId,
        provider,
        role,
        name: role === 'orchestrator' ? 'orchestrator' : `${provider}-${existing}`,
        cwd: get().cwd,
        state: 'idle',
        // Auto by default: an agent that can't run its own build is useless,
        // and the failure reads as a broken app rather than a locked one.
        permission: 'auto',
        // Medium by default rather than the provider's own default, which is
        // lower than most real work wants.
        effort: 'medium',
        messages: [],
        usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
        skillIds: [],
      },
    }
    set((s) => ({ nodes: [...s.nodes, node], selectedId: id }))
    logPulse(api, 
      id,
      'spawned',
      role === 'orchestrator'
        ? `Orchestrator started on ${PROVIDER_LABEL[provider]}.`
        : `Agent started on ${PROVIDER_LABEL[provider]}.`,
    )
    return id
  },

  addSkill: (pos, seed) => {
    const id = `node_${uid()}`
    const node: GtNode = {
      id,
      type: 'skill',
      position: pos,
      data: {
        skillId: `skill_${uid()}`,
        name: seed?.name ?? 'new-skill',
        description: seed?.description ?? 'What this skill makes the agent do',
        trigger: (seed?.trigger ?? 'on-attach') as SkillTrigger,
        body: seed?.body ?? '',
      },
    }
    set((s) => ({ nodes: [...s.nodes, node], selectedId: id }))
    return id
  },

  addFolder: (path, pos, seed) => {
    const id = `node_${uid()}`
    set((s) => ({
      nodes: [
        ...s.nodes,
        { id, type: 'folder', position: pos, data: { folderId: `dir_${uid()}`, path, ...seed } },
      ],
      selectedId: id,
    }))
    if (seed?.draft) return id
    // Verify lazily so a stale folder shows as missing instead of failing a spawn.
    void dirExists(path).then((ok) =>
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isFolder(n) ? { ...n, data: { ...n.data, missing: !ok } } : n,
        ) as GtNode[],
      })),
    )
    return id
  },

  addWorktree: (pos) => {
    const st = get()
    // The repository to cut from: whatever this canvas is already working in.
    // A worktree of nothing is not a thing you can place, so this refuses
    // rather than opening a picker the gesture did not ask for.
    const fromNode = st.nodes.find(
      (n): n is GtNode & { type: 'folder' } => isFolder(n) && !n.data.draft && !n.data.missing,
    )
    const repo = fromNode?.data.path ?? st.cwd
    if (!repo) return null
    return get().addFolder('', pos, { draft: true, worktree: { branch: '', repo } })
  },

  createWorktree: async (nodeId, name) => {
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!node || !isFolder(node) || !node.data.worktree) return { error: 'that node is gone' }
    if (!name.trim()) return { error: 'give the branch a name' }

    let wt: Awaited<ReturnType<typeof worktreeAdd>>
    try {
      wt = await worktreeAdd(node.data.worktree.repo, name)
    } catch (e) {
      return { error: String(e) }
    }

    // The draft becomes the checkout it was standing in for, in place: the
    // node keeps its position and any edges already drawn to it.
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isFolder(n)
          ? {
              ...n,
              data: {
                ...n.data,
                path: wt.path,
                draft: false,
                missing: false,
                worktree: { branch: wt.branch, repo: wt.repo },
              },
            }
          : n,
      ) as GtNode[],
    }))
    return null
  },

  removeWorktree: async (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!node || !isFolder(node)) return { error: 'that node is gone' }

    // A draft never made it to disk; deleting the node is the whole job.
    if (node.data.draft || !node.data.worktree) {
      get().removeNode(nodeId)
      return null
    }
    try {
      await worktreeRemove(node.data.path)
    } catch (e) {
      // git refuses while there is uncommitted work, and says what is unsaved.
      // That refusal is the point: this is where an agent's last hour lives.
      return { error: String(e) }
    }
    get().removeNode(nodeId)
    return null
  },

  attachFolder: (sessionNodeId, path, seed) => {
    const st = get()
    const session = st.nodes.find((n) => n.id === sessionNodeId)
    if (!session || !isSession(session)) return null

    // Already reachable from this session — by path, since two folder nodes
    // may hold the same directory.
    const already = folderRootsFor(st.nodes, st.edges, sessionNodeId)
    const dupe = already.find((r) => samePath(r.path, path))
    if (dupe) {
      set({ selectedId: dupe.nodeId })
      return null
    }

    const existing = st.nodes.find((n) => isFolder(n) && samePath(n.data.path, path))
    const folderId =
      existing?.id ??
      get().addFolder(
        path,
        findFreeSpot(
          {
            x: session.position.x - 320,
            y: session.position.y,
            w: 256,
            h: 76,
          },
          st.nodes.map(boxOf),
        ),
        seed,
      )

    // Same first-wins rule as wiring the edge by hand.
    const type = already.some((r) => r.primary) ? 'attach' : 'cwd'
    set((s) => ({
      edges: [
        ...s.edges,
        { id: `${type}_${uid()}`, source: folderId, target: sessionNodeId, type },
      ],
    }))
    return folderId
  },

  detachFolder: (sessionNodeId, folderNodeId) =>
    set((s) => {
      const edge = s.edges.find(
        (e) =>
          e.target === sessionNodeId &&
          e.source === folderNodeId &&
          (e.type === 'cwd' || e.type === 'attach'),
      )
      if (!edge) return s
      // Losing the working directory while extra roots remain would leave the
      // session unable to run but visibly wired to folders — the worst state
      // available. Reconciliation promotes the oldest survivor and says so.
      return reconcileFolders(
        s.nodes,
        s.edges,
        s.edges.filter((e) => e.id !== edge.id),
      )
    }),

  // Uniqueness enforced by the writer, in one `set`: the incumbent is demoted
  // in the same update that promotes its replacement, so "exactly one cwd edge
  // per session" is never briefly false.
  setPrimaryFolder: (sessionNodeId, folderNodeId) =>
    set((s) => {
      const target = s.edges.find(
        (e) => e.target === sessionNodeId && e.source === folderNodeId && e.type === 'attach',
      )
      if (!target) return s
      return {
        edges: s.edges.map((e) => {
          if (e.id === target.id) return { ...e, type: 'cwd' }
          if (e.target === sessionNodeId && e.type === 'cwd') return { ...e, type: 'attach' }
          return e
        }),
      }
    }),

  isolateSession: async (sessionNodeId) => {
    const st = get()
    const session = st.nodes.find((n) => n.id === sessionNodeId)
    if (!session || !isSession(session)) return { error: 'that agent is gone' }

    const roots = folderRootsFor(st.nodes, st.edges, sessionNodeId)
    const from = roots.find((r) => r.primary)?.path ?? session.data.cwd
    if (!from) return { error: 'wire a folder in first — there is no repository to branch from' }

    let wt: Awaited<ReturnType<typeof worktreeAdd>>
    try {
      wt = await worktreeAdd(from, session.data.name)
    } catch (e) {
      // git's own message names what went wrong, and is better than anything
      // this layer could write in its place.
      return { error: String(e) }
    }

    // The checkout is a real directory, so it becomes a real node: attaching it
    // is what puts it on the canvas, and promoting it is what makes the agent
    // work there. A worktree the canvas cannot see would be the one thing this
    // feature exists to prevent.
    const folderId = get().attachFolder(sessionNodeId, wt.path, {
      worktree: { branch: wt.branch, repo: wt.repo },
    })
    const existing = get().nodes.find((n) => isFolder(n) && samePath(n.data.path, wt.path))
    const id = folderId ?? existing?.id
    if (id) get().setPrimaryFolder(sessionNodeId, id)
    // A checkout reached this way and one placed by hand are the same thing on
    // disk, so they are the same node on the canvas: an existing folder node
    // for this path learns what it is.
    if (existing) {
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === existing.id && isFolder(n)
            ? { ...n, data: { ...n.data, worktree: { branch: wt.branch, repo: wt.repo } } }
            : n,
        ) as GtNode[],
      }))
    }

    return { branch: wt.branch }
  },

  addFile: (path, pos, origin = 'user') => {
    const existing = get().nodes.find((n) => isFile(n) && n.data.path === path)
    if (existing) return existing.id
    const id = `node_${uid()}`
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'file',
          position: pos,
          data: { fileId: `file_${uid()}`, path, origin, touchedAt: Date.now() },
        },
      ],
      ...(origin === 'user' ? { selectedId: id } : {}),
    }))
    // Through the shared cache: an agent that just read this file paid for it
    // already, and the node only needs the first 400 characters of it.
    void readShared(path, 24_000)
      .then((peek) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id && isFile(n)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    preview: peek.text.slice(0, 400),
                    bytes: peek.bytes,
                    binary: peek.binary,
                  },
                }
              : n,
          ) as GtNode[],
        })),
      )
      .catch((e: unknown) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id && isFile(n) ? { ...n, data: { ...n.data, error: String(e) } } : n,
          ) as GtNode[],
        })),
      )
    return id
  },

  toggleLibrary: () => set((s) => ({ libraryOpen: !s.libraryOpen })),
  toggleAutoTidy: () => set((s) => ({ autoTidy: !s.autoTidy })),

  togglePlanning: () => set((s) => ({ planning: !s.planning })),
  setIsolateSpawns: (isolateSpawns) => set({ isolateSpawns }),
  setCheckCommand: (checkCommand) => set({ checkCommand }),
  setGuards: (guards) => set({ guards }),

  compact: async (nodeId) => {
    const st = get()
    const node = st.nodes.find((n) => n.id === nodeId)
    if (!node || !isSession(node)) return { error: 'that agent is gone' }
    if (node.data.state === 'thinking' || node.data.state === 'streaming') {
      return { error: 'wait for the turn to finish first' }
    }

    const before = node.data.messages.length
    // The agent writes its own note: nothing else has read the conversation,
    // and a summary written from the outside would be a summary of the
    // transcript rather than of the work.
    await get().send(nodeId, COMPACT_PROMPT)

    const after = get().nodes.find((n) => n.id === nodeId)
    if (!after || !isSession(after)) return { error: 'that agent is gone' }
    const summary = lastSaid(after.data.messages.slice(before))
    if (!summary.trim()) return { error: 'the agent wrote no handover note' }

    const at = Date.now()
    const cwd = resolveCwd(get().nodes, get().edges, nodeId) ?? after.data.cwd
    let path: string
    try {
      path = await writeNote(noteName(after.data.name, at), noteFile(after.data.name, at, cwd, summary))
    } catch (e) {
      return { error: String(e) }
    }

    // On the canvas before the window is dropped, and wired to the agent that
    // wrote it: a note nobody can find is the invisible truncation this was
    // built to replace.
    const fileId = get().addFile(path, findFreeSpot(
      { x: after.position.x - 300, y: after.position.y + 140, w: 240, h: 68 },
      get().nodes.map(boxOf),
    ))
    set((s) => ({
      edges: [...s.edges, { id: `file_${uid()}`, source: fileId, target: nodeId, type: 'file' }],
    }))

    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isSession(n)
          ? {
              ...n,
              data: {
                ...n.data,
                // The next turn opens a new provider session, which is what
                // actually empties the window.
                providerSessionId: undefined,
                carry: summary,
                compactions: (n.data.compactions ?? 0) + 1,
                // Everything a fresh session has to be told again, because it
                // will not be the session that was told the first time.
                sentInstructions: undefined,
                sentFolders: undefined,
                sentRoster: undefined,
                sentPeers: undefined,
                sentFilesKnown: undefined,
                sentFiles: {},
                sentOrchestrator: undefined,
                // The meter describes a conversation that no longer exists.
                contextTokens: undefined,
                messages: [
                  {
                    id: uid(),
                    role: 'system' as const,
                    text: `Context window recycled. The handover note is on the canvas, and rides on the next turn.`,
                    tools: [],
                  },
                ],
              },
            }
          : n,
      ) as GtNode[],
    }))

    logPulse(api, nodeId, 'compact', `window recycled into a handover note`)
    return null
  },

  runCheckFor: async (nodeId) => {
    const st = get()
    const command = st.checkCommand.trim()
    const node = st.nodes.find((n) => n.id === nodeId)
    if (!command || !node || !isSession(node)) return
    // Already running: a second suite in the same directory as the first is
    // two runs fighting over the same build artefacts, and the answer to
    // "what does the check say" is the one already on its way.
    if (node.data.check?.state === 'running') return

    // The directory it actually works in, which after isolation is its own
    // checkout — the whole point of checking per agent rather than per canvas.
    const cwd = folderRootsFor(st.nodes, st.edges, nodeId).find((r) => r.primary)?.path ?? node.data.cwd
    if (!cwd) return

    const patch = (check: SessionNodeData['check'], unchecked?: boolean) =>
      useStore.setState((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === nodeId && n.type === 'session'
            ? { ...n, data: { ...n.data, check, ...(unchecked === undefined ? {} : { unchecked }) } }
            : n,
        ) as GtNode[],
      }))

    patch({ state: 'running', at: Date.now() })
    const out = await runCheck(cwd, command).catch((e: unknown) => ({
      ok: false,
      code: null,
      ms: 0,
      tail: '',
      error: String(e),
    }))

    patch(
      {
        state: out.ok ? 'pass' : 'fail',
        at: Date.now(),
        ms: out.ms,
        code: out.code,
        tail: out.tail || undefined,
        error: out.error ?? undefined,
      },
      // Checked, whatever it said. A failing check is still an answer about
      // the work as it stands; re-running it unprompted would loop.
      false,
    )

    // The feed says it plainly, so a squad's verdicts arrive in one place
    // rather than on four nodes you have to go and look at.
    const seconds = out.ms >= 1000 ? ` in ${(out.ms / 1000).toFixed(1)}s` : ''
    logPulse(api, 
      nodeId,
      'check',
      out.error
        ? `checks could not run — ${out.error}`
        : out.ok
          ? `checks pass${seconds}`
          : `checks fail${out.code == null ? '' : ` (exit ${out.code})`}${seconds}`,
    )
  },

  addPlanStep: (planId, at) => {
    const plan = get().plans.find((p) => p.id === planId)
    if (!plan) return null
    const id = `step_${uid()}`
    const next = insertStep(plan, at, id)
    if (!next) return null
    set((s) => ({ plans: withPlan(s.plans, planId, () => next) }))
    return id
  },

  // Keyed by the step rather than the plan: step ids are unique across every
  // plan on the canvas, and the node doing the editing has one in its hand.
  editPlanStep: (stepId, patch) =>
    set((s) => ({
      plans: s.plans.map((p) =>
        p.steps.some((st) => st.id === stepId)
          ? { ...p, steps: p.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) }
          : p,
      ),
    })),

  // A plan with every step struck out is a discarded plan — `withPlan` drops
  // an emptied one rather than leaving a headline with nothing under it.
  removePlanStep: (stepId) =>
    set((s) => {
      const held = findStep(s.plans, stepId)
      return held
        ? {
            plans: withPlan(s.plans, held.plan.id, (p) => ({
              ...p,
              steps: p.steps.filter((st) => st.id !== stepId),
            })),
          }
        : s
    }),

  discardPlan: (planId) => set((s) => ({ plans: s.plans.filter((p) => p.id !== planId) })),

  approvePlanStep: async (stepId) => {
    const held = findStep(get().plans, stepId)
    if (!held || held.step.state !== 'pending') return
    // A step you added and have not filled in yet. The node's own button is
    // disabled, but nothing else may spawn a nameless agent either.
    if (!stepReady(held.step)) return
    await runPlanStep(api, held.plan.fromNodeId, stepId)
  },

  approvePlan: async (planId) => {
    // A fan-out is the one shape where the steps do not read each other, which
    // is the only thing that makes running them at once safe — and it is the
    // orchestrator that said so, in the PATTERN line, before the user approved
    // the plan it was written under.
    const plan0 = get().plans.find((p) => p.id === planId)
    if (!plan0) return
    if (fansOut(plan0.pattern?.id) && !plan0.warning) return runPlanFanout(api, planId)

    // Otherwise one at a time, in order. The steps of a plan are a sequence —
    // a reviewer reads what the implementer wrote — and running them at once
    // would hand every one of them the state from before any of them ran.
    //
    // Only this plan's steps: another plan on the same orchestrator is another
    // job, and approving one is not approving the other.
    for (;;) {
      const plan = get().plans.find((p) => p.id === planId)
      if (!plan) return
      const step = nextStep(plan.steps)
      if (!step) return
      // Stop at a step you have not finished writing rather than failing it:
      // the run is waiting on you, and the card says so.
      if (!stepReady(step)) return
      await runPlanStep(api, plan.fromNodeId, step.id)
    }
  },

  claimNode: (id) =>
    set((s) => {
      if (!s.autoPlaced.has(id)) return s
      const next = new Set(s.autoPlaced)
      next.delete(id)
      return { autoPlaced: next }
    }),

  tidy: (all = false) =>
    set((s) => {
      const placed = layoutCanvas(s.nodes, s.edges, all ? undefined : s.autoPlaced, s.plans)
      return {
        nodes: s.nodes.map((n) =>
          placed[n.id] ? { ...n, position: placed[n.id] } : n,
        ) as GtNode[],
      }
    }),

  initLibrary: async () => {
    try {
      const saved = await loadLibrary()
      // Seed on a genuinely empty library, not on every launch — a user who
      // deletes the starters should not have them come back.
      if (saved.length) {
        set({ library: dedupeByName(saved) })
      } else {
        set({ library: STARTER_PERSONAS })
        await saveLibrary(STARTER_PERSONAS)
      }
    } catch {
      // A broken library file must not stop the app from opening.
      set({ library: STARTER_PERSONAS })
    }
  },

  setLibrary: async (incoming) => {
    // Enforced here rather than at each call site: a duplicate name makes
    // SPAWN ambiguous no matter how it got in.
    const library = dedupeByName(incoming)
    set({ library })
    try {
      await saveLibrary(library)
    } catch (e) {
      set({ canvasError: String(e) })
    }
  },

  patchTerminal: (nodeId, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isTerminal(n) ? { ...n, data: { ...n.data, ...patch } } : n,
      ) as GtNode[],
    })),

  setDensity: (nodeId, density) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId || !isSession(n)) return n
        // Deleted rather than stored as undefined: a node with no pin and a
        // node pinned to nothing are the same node, and writing the key would
        // put a meaningless field in every saved canvas.
        const { density: _drop, ...rest } = n.data
        return { ...n, data: density ? { ...rest, density } : rest }
      }) as GtNode[],
    })),

  addTerminal: (pos) => {
    const id = `node_${uid()}`
    const taken = new Set(
      get()
        .nodes.filter(isTerminal)
        .map((n) => n.data.name),
    )
    let name = 'terminal'
    for (let i = 2; taken.has(name); i++) name = `terminal-${i}`
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'terminal',
          position: pos,
          data: { terminalId: `term_${uid()}`, name },
        } as GtNode,
      ],
    }))
    return id
  },

  togglePanel: (key) =>
    set((s) => ({
      panels: { ...s.panels, [key]: { ...s.panels[key], open: !s.panels[key].open } },
    })),

  setPanelMinimized: (key, minimized) =>
    set((s) => ({ panels: { ...s.panels, [key]: { ...s.panels[key], minimized } } })),

  showPanel: (key) => set((s) => ({ panels: { ...s.panels, [key]: { open: true, minimized: false } } })),

  postNote: (body) => {
    const text = body.trim()
    if (!text) return
    set((s) => ({
      bus: [
        ...s.bus,
        {
          id: uid(),
          // Not an agent, so no agent is excluded as its author: a note from
          // you is owed to every one of them.
          sessionId: 'user',
          sessionName: 'you',
          kind: 'user' as const,
          body: text.slice(0, 600),
          ts: Date.now(),
        },
      ],
    }))
  },

  removeNote: (id) =>
    set((s) => ({
      // Watermarks are left alone on purpose. An agent that has already been
      // given this cannot un-read it, and clearing the record would send it
      // again the next time the board is read.
      bus: s.bus.filter((e) => e.id !== id),
    })),

  addChanges: (pos) => {
    const existing = get().nodes.find((n) => n.type === 'changes')
    if (existing) return existing.id
    const id = `node_${uid()}`
    set((s) => ({
      nodes: [
        ...s.nodes,
        { id, type: 'changes', position: pos, data: { changesId: `changes_${uid()}` } } as GtNode,
      ],
    }))
    return id
  },

  addMcp: (server, pos) => {
    const existing = get().nodes.find((n) => isMcp(n) && n.data.name === server.name)
    if (existing) return existing.id
    const id = `node_${uid()}`
    set((s) => ({
      nodes: [
        ...s.nodes,
        { id, type: 'mcp', position: pos, data: { mcpId: `mcp_${uid()}`, ...server } },
      ],
      selectedId: id,
    }))
    return id
  },

  /**
   * The library's "add to canvas" used to drop a personality node — a template
   * you then had to wire up. A persona describes an agent, so it makes one.
   */
  addSessionFromPersona: (persona, pos) => {
    const id = get().addSession(persona.provider, pos)
    const taken = new Set(
      get()
        .nodes.filter(isSession)
        .filter((n) => n.id !== id)
        .map((n) => n.data.name),
    )
    let name = persona.name
    for (let i = 2; taken.has(name); i++) name = `${persona.name}-${i}`

    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isSession(n)
          ? {
              ...n,
              data: {
                ...n.data,
                name,
                permission: persona.permission,
                instructions: persona.instructions.trim(),
                ...(persona.model ? { model: persona.model } : {}),
                ...(persona.effort ? { effort: persona.effort } : {}),
              },
            }
          : n,
      ) as GtNode[],
    }))
    return id
  },

  updateSkill: (nodeId, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isSkill(n) ? { ...n, data: { ...n.data, ...patch } } : n,
      ) as GtNode[],
    })),

  removeNode: (id) => {
    // Pasted images outlive a turn — `--resume` can send the CLI back to the
    // same path — so they're only dropped when the session itself goes.
    const gone = get().nodes.find((n) => n.id === id)
    if (gone && isSession(gone)) void clearSessionImages(gone.data.sessionId).catch(() => {})
    // A terminal's shell is a process and its scrollback is memory; neither
    // has anywhere to belong once the node is gone.
    if (gone && isTerminal(gone)) {
      void terminalClose(gone.data.terminalId).catch(() => {})
      forgetEmulator(gone.data.terminalId)
    }
    set((s) => ({
      // Deleting a folder node takes its `cwd` edge with it, so the survivors
      // need an heir promoted the same way detaching one does.
      ...reconcileFolders(
        s.nodes.filter((n) => n.id !== id),
        s.edges,
        s.edges.filter((e) => e.source !== id && e.target !== id),
      ),
      selectedId: s.selectedId === id ? null : s.selectedId,
      // Drop the dock's pointer too. The panel already falls back to the
      // orchestrator, but leaving a dead id around invites confusion later.
      chatTarget: s.chatTarget === id ? null : s.chatTarget,
    }))
  },

  clearCanvas: () => {
    // One at a time rather than a single filter, so each node gets the
    // teardown it would get if the user had deleted it: session images
    // dropped, terminal shells closed, folder heirs promoted.
    for (const n of get().nodes.filter((n) => n.type !== 'folder')) get().removeNode(n.id)

    set((s) => {
      const kept = new Set(s.nodes.map((n) => n.id))
      return {
        // All of these hang off nodes that have just gone: messages waiting
        // for an agent, what each agent has already been handed, and plans
        // whose steps belong to orchestrators no longer on the board.
        bus: [],
        delivered: {},
        plans: [],
        selectedId: null,
        chatTarget: null,
        openFilePath: null,
        autoPlaced: new Set([...s.autoPlaced].filter((id) => kept.has(id))),
      }
    })
  },

  renameSession: (nodeId, name) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isSession(n) ? { ...n, data: { ...n.data, name } } : n,
      ) as GtNode[],
    })),

  markNotificationsRead: () =>
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
  clearNotifications: () => set({ notifications: [] }),

  setRightTab: (rightTab) => set({ rightTab, libraryOpen: true }),
  setChatTarget: (chatTarget) => set({ chatTarget }),
  setComposerDraft: (composerSeed) => set({ composerSeed }),
  clearComposerSeed: () => set({ composerSeed: null }),
  setOrchestra: (patch) => set((s) => ({ orchestra: { ...s.orchestra, ...patch } })),

  setModel: (nodeId, model) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isSession(n) ? { ...n, data: { ...n.data, model } } : n,
      ) as GtNode[],
    })),

  /**
   * Change how hard a session thinks — and if it is thinking right now, make
   * that count for the answer you are waiting on rather than the one after it.
   *
   * Effort is a process argument, fixed when the turn starts, so a mid-turn
   * change would otherwise be invisible until the next message. Raising it
   * because the current reply is going badly is exactly when you want it, so
   * the running turn is stopped and re-run from the same prompt. Permission and
   * model are deliberately not wired this way: those change what an agent is
   * allowed to do next, and throwing away completed work to apply them would
   * cost more than waiting.
   */
  setEffort: (nodeId, effort) => {
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!node || !isSession(node) || node.data.effort === effort) return

    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isSession(n) ? { ...n, data: { ...n.data, effort } } : n,
      ) as GtNode[],
    }))

    const busy = node.data.state === 'thinking' || node.data.state === 'streaming'
    if (!busy) return

    // Replay the prompt that started the turn being abandoned, not the last
    // thing in the transcript — a delegated or queued turn ends with other
    // traffic.
    const replay = [...node.data.messages].reverse().find((m) => m.role === 'user')
    if (replay) {
      set((s) => ({
        restarting: { ...s.restarting, [nodeId]: { text: replay.text, images: replay.images ?? [] } },
      }))
    }
    void get().interrupt(nodeId)
  },

  setInstructions: (nodeId, instructions) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isSession(n) ? { ...n, data: { ...n.data, instructions } } : n,
      ) as GtNode[],
    })),

  setPermission: (nodeId, permission) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && isSession(n) ? { ...n, data: { ...n.data, permission } } : n,
      ) as GtNode[],
    })),

  // ── the turn ────────────────────────────────────────────────────────

  send: async (nodeId, text, pasted = []) => {
    const s = get()
    const node = s.nodes.find((n) => n.id === nodeId)
    if (!node || !isSession(node)) return

    // A session is `streaming` for most of a turn, not `thinking`, so guarding
    // on `thinking` alone let messages through mid-reply — the backend then
    // refused them and the rejection landed in the transcript as an error.
    // Typing at a busy agent is reasonable; hold the message and send it when
    // the turn ends.
    if (node.data.state === 'thinking' || node.data.state === 'streaming') {
      set((st) => ({
        queued: { ...st.queued, [nodeId]: [...(st.queued[nodeId] ?? []), { text, images: pasted }] },
      }))
      return
    }
    const d = node.data

    // 0. The folder node wired into this session is its working directory.
    // Any others are extra roots it may read from — context, not a second cwd.
    const roots = folderRootsFor(s.nodes, s.edges, nodeId)
    const cwd = resolveCwd(s.nodes, s.edges, nodeId)
    const noFolder = (text: string) =>
      set((st) => ({
        nodes: st.nodes.map((n) =>
          n.id === nodeId && isSession(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  messages: [
                    ...n.data.messages,
                    { id: uid(), role: 'system' as const, text, tools: [], error: true },
                  ],
                },
              }
            : n,
        ) as GtNode[],
      }))

    if (!cwd) {
      noFolder(
        'No folder attached. Wire a folder node into this session, or add one from the folder menu above the composer, to give it a working directory.',
      )
      return
    }
    // A missing working directory fails inside the spawn otherwise, where the
    // error reads as a broken provider rather than a folder that has moved.
    if (roots.find((r) => r.primary)?.missing) {
      noFolder(
        `Working directory not found: ${cwd}. Re-pick it on the folder node, or promote another folder from the folder menu.`,
      )
      return
    }

    // 1. Skills attached to this session become a preamble.
    const skills = s.nodes
      .filter(isSkill)
      .filter((sk) => d.skillIds.includes(sk.data.skillId))
      .filter((sk) => sk.data.trigger === 'always' || !d.providerSessionId)

    // 2. The shared board: everything this agent has not been given yet, from
    // every agent on the canvas, wired to it or not. See `sharedcontext.ts`.
    const already = s.delivered[d.sessionId] ?? new Set<string>()
    const fresh = freshFor(s.bus, already, d.sessionId)

    // 3. Peers this agent may delegate to (POC stand-in for the MCP ask_agent tool).
    const peers = s.nodes
      .filter(isSession)
      .filter((n) => n.id !== nodeId)
      .filter((n) => s.edges.some((e) => e.type === 'context' && e.source === nodeId && e.target === n.id))

    // 2b. File nodes wired into this session are read fresh and injected.
    const attachedFiles = s.edges
      .filter((e) => e.target === nodeId && e.type === 'file')
      .map((e) => s.nodes.find((n) => n.id === e.source))
      .filter((n): n is GtNode & { type: 'file' } => !!n && isFile(n))

    // A file already sent to this agent is in its history, unchanged on disk,
    // and costs nothing to leave out — so only what is new or has actually
    // been edited since is injected. The read goes through the shared cache,
    // so a file wired into four agents is read from disk once.
    const fileBlocks: string[] = []
    const sentFiles: Record<string, string> = {}
    // Pasted images first, then any image file nodes wired in — same order the
    // user sees them.
    const images: string[] = [...pasted]
    let fileBudget = FILE_BUDGET_CHARS
    for (const f of attachedFiles) {
      const path = f.data.path
      const seen = d.sentFiles?.[path]
      // An image file node goes to the provider as an image, not as text. It
      // used to be dropped here, silently and before a digest was recorded, so
      // wiring a screenshot into an agent did nothing at all.
      //
      // `attachableImage`, not `fileKind` — the latter answers what the app can
      // render, and would send an SVG down here instead of injecting its
      // markup as text.
      if (attachableImage(path)) {
        // The bytes never enter the app, so size and mtime are the digest: a
        // screenshot re-saved over the same path has to go out again, which a
        // digest of the path alone could never notice.
        const st = await fileStamp(path).catch(() => null)
        // Not there. No digest recorded, so it goes out when it comes back —
        // the same way the text path treats a file it can't read, rather than
        // failing the whole turn.
        if (!st) {
          fileBlocks.push(`<canvastrator-file path="${path}" error="unreadable" />`)
          continue
        }
        const stamp = digest(`image:${st.bytes}:${st.mtimeMs}`)
        sentFiles[path] = stamp
        if (stamp !== seen) images.push(path)
        continue
      }
      try {
        // Read even when the budget is spent: an unread file has no digest,
        // and skipping it would make it look unchanged on the next turn.
        const peek = await readShared(path, 24_000)
        // Anything else binary can't be shown and can't be read. Say so, once,
        // rather than leaving the agent to wonder why the file it was given
        // never arrived.
        if (peek.binary) {
          const stamp = digest(`binary:${peek.bytes}`)
          sentFiles[path] = stamp
          if (stamp !== seen) {
            fileBlocks.push(
              `<canvastrator-file path="${path}" binary="true" bytes="${peek.bytes}" />`,
            )
          }
          continue
        }
        const stamp = digest(peek.text)
        sentFiles[path] = stamp
        if (stamp === seen) continue
        if (fileBudget <= 0) continue
        const body = peek.text.slice(0, fileBudget)
        fileBudget -= body.length
        const changed = seen ? ' changed="true"' : ''
        fileBlocks.push(
          `<canvastrator-file path="${path}"${changed}${peek.truncated ? ' truncated="true"' : ''}>\n${body}\n</canvastrator-file>`,
        )
      } catch {
        // No digest recorded: an unreadable file must be retried next turn
        // rather than remembered as successfully sent.
        fileBlocks.push(`<canvastrator-file path="${path}" error="unreadable" />`)
      }
    }

    const parts: string[] = []
    // 0. Canvas rules lead the brief, and only on the session's opening turn:
    // they are captured when the agent is spawned, the same way a persona's
    // instructions are. Editing them mid-run leaves live sessions on the rules
    // they started with and applies the new ones to whatever is spawned next.
    if (!d.providerSessionId) {
      const rules = globalRulesBlock(s.globalRules)
      if (rules) parts.push(rules)
    }
    // How the rest of this conversation is put together, before any of it
    // arrives. Every agent, not just orchestrators — they all now receive a
    // setup that does not repeat itself.
    if (!d.providerSessionId) parts.push(standingBlock())
    // The handover note from the window this session replaced. Only ever on
    // the opening turn: it is a handover, not a standing instruction, and
    // repeating it would refill the window it was written to empty.
    if (!d.providerSessionId && d.carry) {
      const carry = carryBlock(d.carry)
      if (carry) parts.push(carry)
    }
    // This agent's standing brief, when it is new or has been edited since.
    const brief = (d.instructions ?? '').trim()
    const briefChanged = brief !== (d.sentInstructions ?? '').trim()
    if (brief && briefChanged) {
      parts.push(`<canvastrator-role>\n${brief}\n</canvastrator-role>`)
    }
    // How a worker hands its result back. Once, on its opening turn — it is a
    // standing instruction and the session's history keeps it.
    if (d.role === 'worker' && !d.providerSessionId) {
      parts.push(REPORT_INSTRUCTION)
    }
    // The folders this agent can reach. Sent when it is new and again whenever
    // the set changes: folders are usually wired in after the conversation has
    // started, and an agent told only at spawn would never hear about them.
    const folderKey = folderSetKey(roots)
    const sentFolderKey = d.sentFolders ?? ''
    const foldersChanged = folderKey !== sentFolderKey
    if (foldersChanged) {
      const folders = canvasFoldersBlock(roots)
      // Shrinking back to one folder renders as nothing, so the retraction has
      // to be said explicitly; more than one extra was in the last key.
      if (folders) parts.push(folders)
      else if (sentFolderKey.includes('\n')) parts.push(canvasFoldersEndedBlock(roots))
    }

    if (fileBlocks.length) {
      parts.push(fileBlocks.join('\n'))
    }
    // What everyone else on this canvas has already opened. Only the entries
    // this agent has not been given: the map grows on most turns, and re-sending
    // it whole would be the same waste in a different shape.
    const known = filesKnown(s.nodes, s.edges, nodeId)
    const knownKey = filesKnownKey(known)
    const knownChanged = knownKey !== (d.sentFilesKnown ?? '')
    if (knownChanged) {
      const had = new Set((d.sentFilesKnown ?? '').split('\n'))
      const freshFiles = known.filter((f) => !had.has(filesKnownEntry(f)))
      const block = filesKnownBlock(freshFiles)
      if (block) parts.push(block)
    }
    if (skills.length) {
      parts.push(
        skills
          .map((sk) => `<canvastrator-skill name="${sk.data.name}">\n${sk.data.body}\n</canvastrator-skill>`)
          .join('\n'),
      )
    }
    if (fresh.length) {
      let block = ''
      for (const e of fresh) {
        const line = `[${e.sessionName} · ${e.kind}] ${e.body}\n`
        if (block.length + line.length > CONTEXT_BUDGET_CHARS) {
          block += `…${fresh.length - block.split('\n').length} earlier entries omitted\n`
          break
        }
        block += line
      }
      parts.push(
        `<canvastrator-context>\nSince your last turn, elsewhere on this canvas:\n\n${block}</canvastrator-context>`,
      )
    }
    // 3b. Everything this session may instantiate: the persona library, which
    // is available everywhere. Sent once — a resumed session still has it.
    const roster = rosterFor(s.library)
    // The brief carries the protocol *and* the model preference, so the
    // watermark has to move when either does — a preference edited mid-
    // conversation would otherwise never reach an agent already briefed.
    const mode = `${s.planning ? 'plan' : 'run'}·${orchestraKey(s.orchestra)}`
    const rKey = rosterKey(roster)
    let sentOrchestrator = d.sentOrchestrator
    let sentRoster = d.sentRoster
    if (d.role === 'orchestrator') {
      if (d.sentOrchestrator !== mode) {
        // New agent, or planning mode flipped under it: the protocol it is
        // holding is the wrong one, so the whole brief goes again.
        parts.push(orchestratorBlock(roster, s.planning, s.orchestra))
        sentOrchestrator = mode
        sentRoster = rKey
      } else if (d.sentRoster !== rKey) {
        // Same protocol, different cast. Only the cast goes.
        parts.push(rosterUpdateBlock(roster))
        sentRoster = rKey
      }
    }

    // Not offered while planning: everything an orchestrator sets in motion
    // goes through a step the user approved.
    const peerList =
      d.role === 'orchestrator' && !s.planning
        ? peers.map((p) => ({ name: p.data.name, provider: p.data.provider }))
        : []
    const pKey = peerKey(peerList)
    const peersChanged = pKey !== (d.sentPeers ?? '')
    if (peersChanged) {
      if (peerList.length) parts.push(peersBlock(peerList))
      // Emptied while it still holds a list — but not merely because planning
      // mode withdrew the protocol, which is not the peers going away.
      else if (d.sentPeers && !s.planning) parts.push(peersEndedBlock())
    }

    // A chore is recognised per turn, never as a standing rule: the next
    // message may be real work, and an orchestrator holding "do not decompose"
    // permanently is worse than one that never heard it.
    if (d.role === 'orchestrator' && looksLikeChore(text)) parts.push(choreBlock(s.planning))

    parts.push(text)
    const prompt = parts.join('\n\n')

    // 4. Optimistic UI: user turn in, assistant placeholder streaming.
    const userMsg: Message = {
      id: uid(),
      role: 'user',
      text,
      tools: [],
      ...(images.length ? { images } : {}),
    }
    const pending: Message = { id: uid(), role: 'assistant', text: '', tools: [], pending: true }

    // What you asked for, in the feed alongside what came back. Without it the
    // Pulse reads as a list of answers to questions nobody can see.
    logPulse(api, nodeId, 'prompt', headlineOf(text))

    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === nodeId && isSession(n)
          ? {
              ...n,
              data: {
                ...n.data,
                cwd,
                state: 'thinking',
                awaitingUser: false,
                ...(briefChanged ? { sentInstructions: brief } : {}),
                ...(foldersChanged ? { sentFolders: folderKey } : {}),
                // The handover has been handed over. Kept on the node until
                // the turn that carries it actually goes out, so a send that
                // failed leaves the note still waiting.
                ...(!d.providerSessionId && d.carry ? { carry: undefined } : {}),
                // Watermarks for everything that now goes only on change.
                // Recorded together with the turn that carried them, so a
                // send that never happened can't mark anything as delivered.
                ...(sentOrchestrator !== d.sentOrchestrator ? { sentOrchestrator } : {}),
                ...(sentRoster !== d.sentRoster ? { sentRoster } : {}),
                ...(peersChanged ? { sentPeers: pKey } : {}),
                ...(knownChanged ? { sentFilesKnown: knownKey } : {}),
                sentFiles,
                turnStartedAt: Date.now(),
                messages: [...n.data.messages, userMsg, pending],
              },
            }
          : n,
      ) as GtNode[],
      // Light up the edges that just carried context.
      edges: st.edges.map((e) =>
        e.target === nodeId && e.type === 'context' && fresh.length
          ? { ...e, data: { ...e.data, flowing: Date.now() } }
          : e,
      ),
      delivered: {
        ...st.delivered,
        [d.sessionId]: new Set([...already, ...fresh.map((f) => f.id)]),
      },
    }))

    try {
      await sendTurn({
        sessionId: d.sessionId,
        provider: d.provider,
        cwd,
        prompt,
        resume: d.providerSessionId ?? null,
        model: d.model ?? null,
        effort: d.effort ?? null,
        permission: d.permission,
        mcpServers: mcpFor(s.nodes, s.edges, nodeId),
        images,
        // Read per turn, so a rule turned on between turns takes effect on the
        // next one rather than on the next agent.
        guards: s.guards,
      })
    } catch (err) {
      get().applyEvent(d.sessionId, { kind: 'failed', message: String(err) })
      get().applyEvent(d.sessionId, { kind: 'exited', code: -1 })
    }
  },

  interrupt: async (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!node || !isSession(node)) return
    try {
      await interruptSession(node.data.sessionId)
    } catch {
      /* nothing in flight */
    }
  },

  applyEvent: (sessionId, ev) => {
    const node = findSessionNode(get().nodes, sessionId)
    if (!node || !isSession(node)) return
    const nodeId = node.id

    const patchNode = (fn: (d: SessionNodeData) => SessionNodeData) =>
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === nodeId && isSession(n) ? { ...n, data: fn(n.data) } : n,
        ) as GtNode[],
      }))

    const patchPending = (fn: (m: Message) => Message) =>
      patchNode((d) => {
        const messages = [...d.messages]
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].pending) {
            messages[i] = fn(messages[i])
            break
          }
        }
        return { ...d, messages }
      })

    switch (ev.kind) {
      case 'started':
        patchNode((d) => {
          // Every block that goes only once — the role, the folders, the
          // orchestrator protocol, the files — is only safe to withhold
          // because the provider is replaying this conversation. A provider
          // that hands back a *different* id did not resume: it started a
          // fresh one, and everything we are relying on it remembering is
          // gone. So the watermarks are dropped and the next turn rebuilds
          // the agent from nothing.
          const lost = !!d.providerSessionId && d.providerSessionId !== ev.providerSessionId
          if (!lost) return { ...d, providerSessionId: ev.providerSessionId }
          return {
            ...d,
            providerSessionId: ev.providerSessionId,
            sentInstructions: undefined,
            sentFolders: undefined,
            sentOrchestrator: undefined,
            sentRoster: undefined,
            sentPeers: undefined,
            sentFilesKnown: undefined,
            sentFiles: undefined,
          }
        })
        break

      case 'capabilities': {
        patchNode((d) => ({
          ...d,
          skills: ev.skills,
          commands: ev.commands,
          mcpServers: ev.mcpServers,
          mcpTools: ev.mcpTools,
        }))
        // Push status and tool names onto the matching MCP nodes, so a server
        // that failed to connect says so on the canvas rather than silently
        // contributing nothing.
        set((s) => ({
          nodes: s.nodes.map((n) => {
            if (!isMcp(n)) return n
            const reported = ev.mcpServers.find((m) => m.name === n.data.name)
            if (!reported) return n
            const prefix = `mcp__${n.data.name}__`
            return {
              ...n,
              data: {
                ...n.data,
                status: reported.status,
                tools: ev.mcpTools
                  .filter((t) => t.startsWith(prefix))
                  .map((t) => t.slice(prefix.length)),
              },
            }
          }) as GtNode[],
        }))
        break
      }

      case 'notice':
        // Keep the last notice visible until real output arrives.
        patchNode((d) => ({ ...d, notice: { label: ev.label, detail: ev.detail } }))
        break

      case 'textDelta':
        patchNode((d) => ({ ...d, state: 'streaming', notice: undefined }))
        patchPending((m) => ({ ...m, text: m.text + ev.text }))
        break

      // Replaced, never accumulated: this is how big the conversation *is*,
      // and it arrives once per API call while a turn runs, so a long tool
      // loop shows the window filling as it happens rather than at the end.
      case 'context':
        patchNode((d) => ({ ...d, contextTokens: ev.tokens }))
        break

      case 'toolCall':
        patchPending((m) => ({
          ...m,
          tools: [...m.tools, { name: ev.name, detail: ev.detail }],
          // The model starts a fresh sentence after acting, but the deltas
          // arrive with no separator — "…orienting in the codebase.Now
          // writing panels.ts". A tool call is a paragraph break.
          text: m.text && !/\s$/.test(m.text) ? `${m.text}\n\n` : m.text,
        }))
        // An MCP call the agent makes shows up on the canvas too — the server
        // it reached for, and the specific tool it used.
        {
          const mcp = parseMcpTool(ev.name)
          if (mcp) void recordMcpUse(api, nodeId, mcp.server, mcp.tool)
        }
        // Every file the agent touches becomes a node wired back to it, so the
        // canvas ends up showing what each agent actually worked on.
        for (const t of ev.paths) {
          void spawnTouchedFile(api, nodeId, absolute(t.path, node.data.cwd), t.write)
        }
        // A write is what makes the last verdict stale. Reads change nothing a
        // check would say, and re-running a suite to learn that is minutes of
        // nothing.
        if (ev.paths.some((t) => t.write)) patchNode((d) => ({ ...d, unchecked: true }))
        break

      case 'result': {
        // Some providers only give the final text in the result event.
        patchPending((m) => ({ ...m, text: m.text || ev.text }))
        patchNode((d) => ({ ...d, notice: undefined }))
        patchNode((d) => ({
          ...d,
          usage: {
            costUsd: d.usage.costUsd + (ev.costUsd ?? 0),
            inputTokens: d.usage.inputTokens + (ev.inputTokens ?? 0),
            outputTokens: d.usage.outputTokens + (ev.outputTokens ?? 0),
          },
          // Replaced, not accumulated: the whole conversation is resent every
          // turn, so this is how big the conversation *is*. A turn that
          // reported nothing leaves the last known figure standing rather than
          // blanking the meter mid-run.
          ...(ev.contextTokens != null ? { contextTokens: ev.contextTokens } : {}),
        }))
        // The turn is over and it wrote something: ask the project whether the
        // work is any good, rather than taking the agent's word for it. Fired
        // rather than awaited — the verdict arrives on the node when it
        // arrives, and nothing else should wait on a test suite.
        {
          const after = useStore.getState().nodes.find((n) => n.id === nodeId)
          if (after && isSession(after) && after.data.unchecked) {
            void useStore.getState().runCheckFor(nodeId)
          }
        }
        break
      }

      case 'failed':
        patchPending((m) => ({ ...m, text: ev.message, error: true }))
        patchNode((d) => ({ ...d, state: 'error' }))
        break

      case 'exited': {
        // A turn we stopped on purpose to re-run at a new effort. Its partial
        // reply is not an answer to anything, so it must not reach the bus, the
        // canvas, or the spawn/delegate scanners — it gets dropped, along with
        // the prompt that produced it, and `send` writes both back fresh.
        const replay = get().restarting[nodeId]
        if (replay !== undefined) {
          set((st) => {
            const { [nodeId]: _dropped, ...rest } = st.restarting
            return { restarting: rest }
          })
          patchNode((d) => ({
            ...d,
            state: 'idle',
            notice: undefined,
            awaitingUser: false,
            turnStartedAt: undefined,
            messages: dropAbandonedTurn(d.messages),
          }))
          setTimeout(() => void get().send(nodeId, replay.text, replay.images), 0)
          break
        }

        // Anything typed while this session was busy goes now, in order.
        const waiting = get().queued[nodeId] ?? []
        if (waiting.length) {
          set((st) => ({ queued: { ...st.queued, [nodeId]: waiting.slice(1) } }))
          setTimeout(() => void get().send(nodeId, waiting[0].text, waiting[0].images), 0)
        }
        const finished = findSessionNode(get().nodes, sessionId)
        const last =
          finished && isSession(finished)
            ? finished.data.messages.filter((m) => m.pending).at(-1)
            : undefined

        patchNode((d) => ({
          ...d,
          state: d.state === 'error' ? 'error' : 'idle',
          notice: undefined,
          // A turn that ended on a question is waiting on you, not done.
          awaitingUser: !!last?.text && !last.error && looksLikeQuestion(last.text),
          // A turn stopped by the user leaves a half-written reply, not an error.
          messages: d.messages
            .filter((m) => !(m.pending && !m.text && !m.tools.length))
            .map((m) => (m.pending ? { ...m, pending: false } : m)),
        }))

        // Publish this turn to the shared bus so downstream agents can see it.
        if (last?.text && !last.error) {
          const author = findSessionNode(get().nodes, sessionId)
          // A worker's own REPORT block where it wrote one: it is the reply
          // reduced by the agent that understood it, which beats the first 600
          // characters of its reasoning — usually the part before it knew
          // anything.
          const summary = parseReport(last.text) ?? last.text
          const entry: ContextEntry = {
            id: uid(),
            sessionId,
            sessionName: author && isSession(author) ? author.data.name : sessionId,
            kind: 'summary',
            body: summary.replace(/\s+/g, ' ').slice(0, 600),
            ts: Date.now(),
          }
          set((s) => ({ bus: [...s.bus, entry] }))
          // …and into the bell, so a turn that finished while you were looking
          // somewhere else is still there when you come back.
          notifyTurn(api, nodeId, last, looksLikeQuestion(last.text))
          // Definitions first: a reply can invent a persona and spawn it in
          // the same breath, and the spawn resolves against the library.
          void maybeDefinePersonas(api, last.text).then(() => {
            // With planning on, what an orchestrator wrote is a proposal. The
            // gate is here rather than in the prompt, so an agent that reaches
            // for a protocol out of habit still can't start work on its own —
            // and that has to cover DELEGATE too, or "run it on an agent that
            // already exists" is a way around the gate rather than a different
            // kind of work.
            const st = get()
            const author = st.nodes.find((n) => n.id === nodeId)
            const gated =
              st.planning && !!author && isSession(author) && author.data.role === 'orchestrator'
            if (gated) {
              proposePlan(api, nodeId, last.text)
            } else {
              void maybeDelegate(api, nodeId, last.text)
              void maybeSpawn(api, nodeId, last.text)
            }
          })
        }
        break
      }
    }
  },
  }))


/**
 * The canvas on screen.
 *
 * Kept here rather than in the strip that owns the ordering, so that nothing
 * below this line has to import upward: `desk.ts` decides which canvas is in
 * view and says so, and everything that just wants "wherever the user is
 * looking" reads it from here.
 */
let active: CanvasStore = createCanvasStore()
const watchers = new Set<() => void>()

export const activeStore = () => active

export function setActiveStore(next: CanvasStore) {
  if (next === active) return
  active = next
  for (const fn of watchers) fn()
}

function watchActive(fn: () => void) {
  watchers.add(fn)
  return () => {
    watchers.delete(fn)
  }
}

/**
 * Which store a component reads.
 *
 * A canvas surface wraps itself in `CanvasStoreContext`, so every node, panel
 * and button inside it talks to its own canvas — several are mounted side by
 * side in the strip, and a node on the canvas two along must not answer for
 * the one you are looking at. Anything rendered outside a surface — the app
 * bar, the command palette — gets the canvas in view, which is what "the
 * canvas" means from out there.
 */
export const CanvasStoreContext = createContext<CanvasStore | null>(null)

/**
 * Read a field off a named canvas, whichever one it is.
 *
 * For the few things that look *across* the desk — the dots that say which
 * canvas is busy — rather than at the canvas they are inside.
 */
export function useCanvasStore<T>(store: CanvasStore, selector: (s: State) => T): T {
  return useZustandStore(store, selector)
}

/**
 * Whether this is the canvas in view.
 *
 * Every canvas on the desk stays mounted — that is what keeps its agents
 * running — which means every one of them also mounts the chrome around it,
 * and the window-level shortcut listeners that chrome installs. One press of
 * ⌘B was being handled once per open canvas: two canvases toggled the sidebar
 * twice and it appeared not to work at all. The keyboard belongs to whichever
 * canvas you are looking at, so the ones behind it hold their peace.
 *
 * True outside any surface too, for chrome that belongs to the desk itself.
 */
export function useInView(): boolean {
  const mine = useContext(CanvasStoreContext)
  const inView = useSyncExternalStore(watchActive, activeStore, activeStore)
  return !mine || mine === inView
}

/**
 * The same answer as `useInView`, as a ref — so a listener registered once can
 * check it on every press without being torn down and rebuilt each time the
 * view moves.
 */
export function useInViewRef() {
  const showing = useInView()
  const ref = useRef(showing)
  ref.current = showing
  return ref
}

export function useStore<T>(selector: (s: State) => T): T {
  const bound = useContext(CanvasStoreContext)
  const inView = useSyncExternalStore(watchActive, activeStore, activeStore)
  return useZustandStore(bound ?? inView, selector)
}

// The bound-store shorthands zustand used to provide, aimed at the canvas in
// view. Every runtime path that acts on a *particular* canvas takes its store
// as an argument instead — see `spawnChild` and the helpers below it.
useStore.getState = () => active.getState()
useStore.setState = ((partial: Parameters<CanvasStore['setState']>[0]) =>
  active.setState(partial)) as CanvasStore['setState']
useStore.subscribe = ((listener: Parameters<CanvasStore['subscribe']>[0]) =>
  active.subscribe(listener)) as CanvasStore['subscribe']

/**
 * POC stand-in for the MCP `ask_agent` tool: if an orchestrator's reply
 * contains a DELEGATE line, actually run that task on the named agent and
 * feed the answer back. Real agent→agent message passing, just negotiated
 * over the transcript instead of over MCP.
 */
/**
 * Materialise a file the agent just read or wrote, and connect it to that
 * agent. Placed in a column beside the session so it doesn't land on top of it.
 */
async function spawnTouchedFile(api: CanvasStore, sessionNodeId: string, path: string, write: boolean) {
  // Paths pulled out of a shell command are guesses. Confirm the file is real
  // before it becomes a node — and give a write a moment to land, since the
  // tool call is reported before the command runs.
  if (!(await fileExists(path))) {
    await new Promise((r) => setTimeout(r, 900))
    if (!(await fileExists(path))) return
  }

  const st = api.getState()
  const session = st.nodes.find((n) => n.id === sessionNodeId)
  if (!session) return

  // A write is the only file touch worth a line in the feed. Reads are how an
  // agent works; writes are what it changed, and are the thing you may want to
  // revert. The edge and the node still record both.
  if (write) logPulse(api, sessionNodeId, 'wrote', path)

  const existing = st.nodes.find((n) => n.type === 'file' && n.data.path === path)
  if (existing) {
    // Already on canvas: just refresh its state and make sure it's connected.
    api.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === existing.id && n.type === 'file'
          ? { ...n, data: { ...n.data, written: n.data.written || write, touchedAt: Date.now() } }
          : n,
      ) as GtNode[],
      // The edge carries the moment of the touch, which is what the canvas
      // animates. A file read earlier and written now upgrades to a write.
      edges: s.edges.some((e) => e.source === sessionNodeId && e.target === existing.id)
        ? s.edges.map((e) =>
            e.source === sessionNodeId && e.target === existing.id && e.type === 'file'
              ? { ...e, data: { ...e.data, write: !!e.data?.write || write, at: Date.now() } }
              : e,
          )
        : [
            ...s.edges,
            {
              id: `touch_${uid()}`,
              source: sessionNodeId,
              sourceHandle: 'produces',
              target: existing.id,
              targetHandle: 'touched-by',
              type: 'file',
              data: { write, at: Date.now() },
            },
          ],
    }))
    return
  }

  const mine = st.edges.filter(
    (e) => e.source === sessionNodeId && e.type === 'file',
  ).length
  if (mine >= MAX_AUTO_FILES_PER_SESSION) return

  // Off the agent's right, stacked — the same lane the layout would put it in,
  // so a canvas with auto-tidy off still reads the right way.
  const width = (session.width as number | undefined) ?? SESSION_SIZE.w
  const height = (session.height as number | undefined) ?? SESSION_SIZE.h
  const desired = {
    x: session.position.x + width + 56,
    y: session.position.y + (height - FILE_SIZE.h) / 2 + mine * (FILE_SIZE.h + 18),
    w: FILE_SIZE.w,
    h: FILE_SIZE.h,
  }
  // Never drop a node on top of one that's already there.
  const pos = findFreeSpot(
    desired,
    st.nodes.filter((n) => n.id !== sessionNodeId).map(boxOf),
  )

  const id = api.getState().addFile(path, pos, 'agent')
  markAutoPlaced(api, id)
  api.setState((s) => ({
    nodes: s.nodes.map((n) =>
      n.id === id && n.type === 'file' ? { ...n, data: { ...n.data, written: write } } : n,
    ) as GtNode[],
    edges: [
      ...s.edges,
      {
        id: `touch_${uid()}`,
        source: sessionNodeId,
        sourceHandle: 'produces',
        target: id,
        targetHandle: 'touched-by',
        type: 'file',
        data: { write, at: Date.now() },
      },
    ],
  }))
}

/**
 * Drop what a finished turn amounted to onto the canvas, wired back to the
 * session that produced it.
 *
 * Derived from the reply rather than asked for: a second model call per turn
 * would double the bill, and an agent told to summarise itself forgets. The
 * summaries stack in a column to the left of the session, so the file nodes on
 * its right stay where they are.
 */
/**
 * Record what a finished turn amounted to.
 *
 * Replaces the summary node that used to land beside the agent. Same
 * derivation — the headline is the agent's own first sentence — but it goes to
 * the bell instead of onto the canvas, so a long-running canvas doesn't fill up
 * with history that nobody is reading.
 */
/**
 * Record something that happened, for the Pulse feed.
 *
 * `notifyTurn` is the turn-shaped version of this, and stays separate because
 * a turn carries a tool list and a headline the *agent* wrote. Everything
 * here is one line the app writes about itself: what you asked for, what shape
 * was chosen, who got spawned, what got written.
 */
function logPulse(api: CanvasStore, sessionNodeId: string,
  kind: NotificationKind,
  headline: string,
  fallback?: { name: string; provider: Provider },
) {
  const text = headline.trim()
  if (!text) return
  const session = api.getState().nodes.find((n) => n.id === sessionNodeId)
  const who =
    session && isSession(session)
      ? { name: session.data.name, provider: session.data.provider }
      : fallback
  if (!who) return

  const entry: Notification = {
    id: uid(),
    sessionNodeId,
    sessionName: who.name,
    provider: who.provider,
    kind,
    headline: text,
    tools: [],
    toolCount: 0,
    ts: Date.now(),
    // Only the kinds the bell shows can arrive unread. The rest are things
    // you did, and a badge asking you to acknowledge your own prompt is one
    // that never clears for a reason nobody wants.
    read: !isBellKind(kind),
  }

  api.setState((s) => ({
    notifications: [entry, ...s.notifications].slice(0, MAX_NOTIFICATIONS),
  }))
}

function notifyTurn(api: CanvasStore, sessionNodeId: string, msg: Message, awaitingUser: boolean) {
  const st = api.getState()
  const session = st.nodes.find((n) => n.id === sessionNodeId)
  if (!session || !isSession(session)) return

  const summary = summarizeTurn(msg)
  // A turn that said nothing quotable — pure tool noise, or an empty reply —
  // is not worth an entry. A blank row is worse than no row.
  if (!summary.headline) return

  const entry: Notification = {
    id: uid(),
    sessionNodeId,
    sessionName: session.data.name,
    provider: session.data.provider,
    kind: awaitingUser ? 'question' : 'turn',
    headline: summary.headline,
    tools: summary.tools,
    toolCount: summary.toolCount,
    ts: Date.now(),
    read: false,
  }

  // Newest first: the feed is read from the top, and the cap drops the stalest.
  api.setState((s) => ({
    notifications: [entry, ...s.notifications].slice(0, MAX_NOTIFICATIONS),
  }))
}

/** A canvas is not improved by fifty tool nodes from one chatty server. */
const MAX_TOOL_NODES_PER_SERVER = 8

/**
 * Show an MCP call on the canvas: the server node if it isn't there yet, and a
 * node for the specific tool.
 *
 * A server the agent reached for is part of what happened, whether or not the
 * user wired it in beforehand — the canvas is the record, so it has to say so.
 */
async function recordMcpUse(api: CanvasStore, sessionNodeId: string, server: string, tool: string) {
  const st = api.getState()
  const session = st.nodes.find((n) => n.id === sessionNodeId)
  if (!session) return

  // 1. The server node.
  let serverNode = st.nodes.find((n) => isMcp(n) && n.data.name === server)
  if (!serverNode) {
    const reported = session.type === 'session'
      ? session.data.mcpServers?.find((m) => m.name === server)
      : undefined
    const id = api.getState().addMcp(
      {
        name: server,
        transport: 'unknown',
        source: 'used by agent',
      },
      findFreeSpot(
        {
          x: session.position.x - 240 - 90,
          y: session.position.y,
          w: 240,
          h: 150,
        },
        api.getState().nodes.map(boxOf),
      ),
    )
    markAutoPlaced(api, id)
    if (reported) {
      api.setState((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isMcp(n) ? { ...n, data: { ...n.data, status: reported.status } } : n,
        ) as GtNode[],
      }))
    }
    serverNode = api.getState().nodes.find((n) => n.id === id)
  }
  if (!serverNode) return

  // Wire it to the agent that used it, if it isn't already.
  api.setState((s) => ({
    edges: s.edges.some((e) => e.source === serverNode!.id && e.target === sessionNodeId)
      ? s.edges
      : [
          ...s.edges,
          { id: `att_${uid()}`, source: serverNode!.id, target: sessionNodeId, type: 'attach' },
        ],
  }))

  // 2. The tool node — one per distinct tool, counting repeat calls.
  const existing = useStore
    .getState()
    .nodes.find((n) => isMcpTool(n) && n.data.server === server && n.data.tool === tool)
  if (existing) {
    api.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === existing.id && isMcpTool(n)
          ? { ...n, data: { ...n.data, calls: n.data.calls + 1, lastAt: Date.now() } }
          : n,
      ) as GtNode[],
    }))
    return
  }

  const mine = useStore
    .getState()
    .nodes.filter((n) => isMcpTool(n) && n.data.server === server).length
  if (mine >= MAX_TOOL_NODES_PER_SERVER) return

  const id = `node_${uid()}`
  const pos = findFreeSpot(
    {
      x: serverNode.position.x + 28,
      y: serverNode.position.y + 150 + 28 + mine * 80,
      w: 200,
      h: 56,
    },
    api.getState().nodes.map(boxOf),
  )
  api.setState((s) => ({
    nodes: [
      ...s.nodes,
      {
        id,
        type: 'mcptool',
        position: pos,
        data: { toolId: `tool_${uid()}`, server, tool, calls: 1, lastAt: Date.now() },
      },
    ],
    edges: [
      ...s.edges,
      {
        id: `use_${uid()}`,
        source: serverNode!.id,
        sourceHandle: 'tools-out',
        target: id,
        targetHandle: 'from-server',
        type: 'mcpuse',
      },
    ],
  }))
  markAutoPlaced(api, id)
}

/**
 * Resolve when a session is no longer mid-turn.
 *
 * `subscribe` only fires on change, so subscribing to a session that is already
 * idle waits forever — which is exactly what happened when the turn failed to
 * start at all (no folder attached, say). The parent then never got its report
 * and simply stopped, with nothing in the transcript to say why.
 */
function whenIdle(api: CanvasStore, nodeId: string): Promise<void> {
  const busy = (s: ReturnType<typeof useStore.getState>) => {
    const n = s.nodes.find((x) => x.id === nodeId)
    return !!n && n.type === 'session' && (n.data.state === 'thinking' || n.data.state === 'streaming')
  }
  if (!busy(api.getState())) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = useStore.subscribe((s) => {
      if (!busy(s)) {
        stop()
        resolve()
      }
    })
  })
}

/** Hand a node to the layout. Only agent-created nodes are ever passed here. */
function markAutoPlaced(api: CanvasStore, id: string) {
  api.setState((s) => ({ autoPlaced: new Set(s.autoPlaced).add(id) }))
}

/**
 * How deep the spawn chain may go: an orchestrator (0) may spawn workers (1),
 * and those may spawn one more level (2). Beyond that a canvas can fan out
 * into a bill nobody asked for.
 *
 * Measured by walking spawn edges up the graph rather than kept in a counter.
 * The counter version incremented on every spawn and was only ever cleared
 * when it tripped, so an orchestrator could spawn exactly twice and was then
 * refused — silently, and for the rest of the session. Depth is a property of
 * the graph, so reading it from the graph is the only version that can't drift.
 */
const MAX_SPAWN_DEPTH = 2

/** Consecutive delegations from one agent before we force a pause. */
const MAX_DELEGATE_CHAIN = 2
const delegations = new Map<string, number>()

/** Children one agent may spawn. Per agent, not per canvas. */
const MAX_CHILDREN_PER_AGENT = 8

/** A backstop on the whole canvas, so a spawn loop can't run up a bill. */
const MAX_SESSIONS = 24


export function spawnDepth(edges: Edge[], nodeId: string): number {
  let depth = 0
  let cur = nodeId
  const seen = new Set<string>([cur])
  for (;;) {
    const up = edges.find((e) => e.type === 'spawn' && e.target === cur)
    if (!up || seen.has(up.source)) return depth
    seen.add(up.source)
    cur = up.source
    depth++
  }
}

/**
 * Tell the user why something didn't happen.
 *
 * Every refusal below used to be a bare `return`. The transcript still showed
 * the agent's `SPAWN` line rendered as a spawn card, so the canvas claimed to
 * have started an agent that does not exist — the one failure mode worse than
 * failing.
 */

/**
 * Agents currently being given a checkout.
 *
 * Two callers race on a spawn — the one that creates the agent and the one
 * that is about to send it its first turn — and two `git worktree add` runs
 * for the same branch is a confusing error rather than a second worktree. The
 * second caller waits on the first's promise and gets the same answer.
 */
const isolating = new Map<string, Promise<{ branch: string } | { error: string }>>()

/**
 * Give a freshly spawned agent its own checkout, when the canvas says so.
 *
 * Silent when the rule is off or the agent has no repository to branch from —
 * a canvas pointed at a plain directory is a normal way to work, not an error
 * worth a message. A git failure is not silent: it lands on the agent's own
 * node, because an agent that quietly shares a directory it was supposed to
 * own is the exact failure this rule exists to prevent.
 */
async function autoIsolate(api: CanvasStore, nodeId: string): Promise<void> {
  const st = api.getState()
  if (!st.isolateSpawns) return
  const node = st.nodes.find((n) => n.id === nodeId)
  if (!node || !isSession(node)) return

  const inFlight = isolating.get(nodeId)
  if (inFlight) {
    await inFlight
    return
  }

  const run = st.isolateSession(nodeId)
  isolating.set(nodeId, run)
  const out = await run.finally(() => isolating.delete(nodeId))
  if ('error' in out) {
    noteOnNode(api, nodeId, `Could not give this agent its own worktree: ${out.error}`)
  }
}

function noteOnNode(api: CanvasStore, nodeId: string, text: string) {
  api.setState((s) => ({
    nodes: s.nodes.map((n) =>
      n.id === nodeId && n.type === 'session'
        ? {
            ...n,
            data: {
              ...n.data,
              messages: [
                ...n.data.messages,
                { id: uid(), role: 'system' as const, text, tools: [], error: true },
              ],
            },
          }
        : n,
    ) as GtNode[],
  }))
}

/**
 * Save personas the orchestrator invented. They go to the library rather than
 * just this canvas: a role worth naming is worth keeping, and the orchestrator
 * is told as much when it defines one.
 */
async function maybeDefinePersonas(api: CanvasStore, text: string) {
  const defined = parsePersonaDefinitions(text)
  if (!defined.length) return

  const current = api.getState().library
  const known = new Set(current.map((p) => p.name.trim().toLowerCase()))
  // An existing name is left alone: redefining "reviewer" mid-conversation
  // would silently rewrite a persona the user tuned themselves.
  const fresh = defined.filter((p) => !known.has(p.name.trim().toLowerCase()))
  if (!fresh.length) return

  await api.getState().setLibrary([...current, ...fresh])
}

/**
 * The orchestrator creating a worker on demand — the point of the whole app.
 *
 * A personality wired into the orchestrator grants it the right to instantiate
 * that personality; a `SPAWN <name>: <task>` line in its reply exercises it.
 * The child lands in the same folder, wired for context both ways, with the
 * personality's instructions as its opening brief. Its answer is fed back, so
 * the orchestrator can carry on with it.
 *
 * This is the POC stand-in for an MCP `spawn_agent` tool, same as DELEGATE.
 */
export function parseSpawn(text: string): { personality: string; task: string } | null {
  // The task runs to the end of the reply, or to the next SPAWN/DELEGATE line.
  //
  // It used to be anchored to a single line, which silently truncated any
  // multi-paragraph brief to its first line — the orchestrator would write a
  // careful three-paragraph task and the child would receive one sentence.
  // `[\s\S]` rather than `.` because `.` never matches a newline, and the
  // task must still start with a non-space character or `SPAWN name:   `
  // spawns an agent with an empty brief.
  // `$` is line-anchored under /m, which would end the task at the first
  // newline — exactly the truncation this is meant to fix. `(?![\s\S])` is
  // the real end of the string regardless of flags.
  const m = text.match(
    /^[ \t]*SPAWN[ \t]+([\w.-]+)[ \t]*:[ \t]*(\S[\s\S]*?)(?=\n[ \t]*(?:SPAWN|DELEGATE)[ \t]+[\w.-]+[ \t]*:|(?![\s\S]))/im,
  )
  return m ? { personality: m[1], task: m[2].trim() } : null
}

async function maybeSpawn(api: CanvasStore, fromNodeId: string, text: string) {
  const parsed = parseSpawn(text)
  if (!parsed) return
  await spawnChild(api, fromNodeId, parsed.personality, parsed.task)
}

/**
 * What came of asking for an agent: the one that ran, or why none did.
 *
 * `report` is only set when the caller asked to be given the hand-back rather
 * than have it sent — see `defer` on `spawnChild`.
 */
type SpawnResult =
  | { ok: true; childId: string; report?: string }
  | { ok: false; error: string }

/**
 * Create a worker, run the task on it, and feed the answer back to whoever
 * asked for it.
 *
 * Split out from the SPAWN protocol so a plan step can use it: a step is a
 * spawn the user agreed to, and the two must not drift into two subtly
 * different ways of starting an agent. Every refusal comes back as a string
 * rather than only landing on the node, so the plan can show which step
 * failed and why.
 */
async function spawnChild(api: CanvasStore, fromNodeId: string,
  personalityName: string,
  task: string,
  /**
   * Return the hand-back instead of sending it to the parent.
   *
   * A fan-out has several children finishing at once, and each of them
   * sending its own report would start several overlapping turns on the same
   * orchestrator. The caller collects them and sends one turn instead, which
   * is both correct and the cheaper of the two: one reply that reads all the
   * results together, rather than N replies each holding one of them.
   */
  defer = false,
): Promise<SpawnResult> {
  const refuse = (error: string): SpawnResult => {
    noteOnNode(api, fromNodeId, error)
    return { ok: false, error }
  }

  const st = api.getState()
  const parent = st.nodes.find((n) => n.id === fromNodeId)
  if (!parent || parent.type !== 'session') {
    return { ok: false, error: 'That agent is no longer on the canvas.' }
  }

  const roster = rosterFor(st.library)
  const persona = roster.find((p) => p.name.toLowerCase() === personalityName.toLowerCase())
  if (!persona) {
    const known = roster.map((p) => p.name).join(', ')
    return refuse(
      `Couldn't spawn "${personalityName}" — no persona by that name.` +
        (known ? ` Available: ${known}.` : ' The persona library is empty.'),
    )
  }

  if (spawnDepth(st.edges, fromNodeId) >= MAX_SPAWN_DEPTH) {
    return refuse(
      `Couldn't spawn "${persona.name}" — already ${MAX_SPAWN_DEPTH} levels deep in spawned agents. Ask the orchestrator to run this itself, or start it from the top.`,
    )
  }

  // Per agent. This used to count every spawn edge on the canvas, so after six
  // spawns in the canvas's whole life every later spawn was refused in silence.
  const myChildren = st.edges.filter((e) => e.type === 'spawn' && e.source === fromNodeId).length
  if (myChildren >= MAX_CHILDREN_PER_AGENT) {
    return refuse(
      `Couldn't spawn "${persona.name}" — this agent already has ${myChildren} children, the limit. Delete some from the canvas to make room.`,
    )
  }

  const sessionCount = st.nodes.filter((n) => n.type === 'session').length
  if (sessionCount >= MAX_SESSIONS) {
    return refuse(
      `Couldn't spawn "${persona.name}" — the canvas is at its limit of ${MAX_SESSIONS} agents.`,
    )
  }

  // Place the child to the right of its parent — the direction the flow reads
  // in — stepped down by sibling index so a squad fans into a column.
  const siblings = st.edges.filter((e) => e.type === 'spawn' && e.source === fromNodeId).length
  const parentSize = sizeOf(parent)
  const pos = findFreeSpot(
    {
      x: parent.position.x + parentSize.w + 150,
      y: parent.position.y + siblings * (SESSION_SIZE.h + 52),
      w: SESSION_SIZE.w,
      h: SESSION_SIZE.h,
    },
    st.nodes.map(boxOf),
  )

  const childId = api.getState().addSession(persona.provider, pos)
  markAutoPlaced(api, childId)
  const taken = new Set(
    useStore
      .getState()
      .nodes.filter((n) => n.type === 'session')
      .map((n) => n.data.name),
  )
  let name = persona.name
  for (let i = 2; taken.has(name); i++) name = `${persona.name}-${i}`

  // Every folder the parent reaches, not just its working directory — a worker
  // spawned to work across two repos needs both, and each edge's type carries
  // which one is primary.
  const parentFolderEdges = st.edges.filter(
    (e) =>
      e.target === fromNodeId &&
      (e.type === 'cwd' || e.type === 'attach') &&
      st.nodes.some((n) => n.id === e.source && n.type === 'folder'),
  )

  api.setState((s) => ({
    nodes: s.nodes.map((n) =>
      n.id === childId && n.type === 'session'
        ? {
            ...n,
            data: {
              ...n.data,
              name,
              permission: persona.permission,
              ...(persona.model ? { model: persona.model } : {}),
              effort: persona.effort ?? 'medium',
              // The brief lives on the agent, so it survives and stays editable
              // rather than being a one-shot message at the top of a transcript.
              instructions: persona.instructions.trim(),
            },
          }
        : n,
    ) as GtNode[],
    edges: [
      ...s.edges,
      // Lineage, so the canvas shows who created whom.
      {
        id: `spawn_${uid()}`,
        source: fromNodeId,
        sourceHandle: 'spawns',
        target: childId,
        targetHandle: 'spawned-by',
        type: 'spawn',
      },
      // Context both ways: the child reports back, the parent can follow up.
      { id: `ctx_${uid()}`, source: childId, target: fromNodeId, type: 'context' },
      { id: `ctx_${uid()}`, source: fromNodeId, target: childId, type: 'context' },
      // Same folders as its parent, primacy preserved, or it has nowhere to run.
      ...parentFolderEdges.map((e) => ({
        id: `${e.type}_${uid()}`,
        source: e.source,
        target: childId,
        type: e.type,
      })),
    ],
  }))

  // Before the first turn, not after: a worker that starts working in the
  // shared directory has already written the file this was meant to protect.
  await autoIsolate(api, childId)

  // The brief rides on the child's own `instructions`, which `send` injects —
  // prepending it here as well would send it twice.
  await api.getState().send(childId, task)

  await whenIdle(api, childId)

  const done = api.getState().nodes.find((n) => n.id === childId)
  const answer = done && done.type === 'session' ? (done.data.messages.at(-1)?.text ?? '') : ''
  if (answer && done?.type === 'session') {
    // The child's whole reply used to be spliced into the parent's context.
    // It is written for the user — it reads files aloud and shows its working —
    // so the parent paid for all of that to find the one paragraph it needed.
    // Its REPORT block is what travels; the rest stays on the child's node.
    handOver(api, parent.data.sessionId, done.data.sessionId)
    const report = reportBlock(name, persona.name, handBack(answer))
    if (defer) return { ok: true, childId, report }
    await api.getState().send(fromNodeId, report)
  }
  return { ok: true, childId }
}

/**
 * Hold the orchestrator to the shape it declared.
 *
 * An agent that has just been told fan-out is expensive will still sometimes
 * write four steps under a shape that means one — the declaration is cheap to
 * write and the plan beneath it is where the money goes. So the count is
 * checked against the shape, the disagreement is put in front of the user on
 * the node, and the plan loses the right to fan out: whichever half is wrong,
 * running it in order is the reading that cannot be expensive by mistake.
 */
function mismatch(api: CanvasStore, fromNodeId: string,
  id: PatternId | undefined,
  count: number,
  /** What the user actually asked for, so a chore can be held to one step. */
  goal = '',
): { warning?: string } {
  // A chore that came back as a plan is the failure this catches: the user
  // named one operation and got a project. The shape check below would let it
  // through, because four steps under "chain" is perfectly consistent — it is
  // only wrong against what was asked.
  if (count > 1 && looksLikeChore(goal)) {
    const complaint = `You asked for one thing and this came back as ${count} steps. Approve only the step you wanted, or drop the plan — running it in order either way.`
    noteOnNode(api, fromNodeId, complaint)
    return { warning: complaint }
  }
  if (!id) return {}
  const complaint = checkShape(id, count)
  if (!complaint) return {}
  noteOnNode(api, fromNodeId, complaint)
  return { warning: complaint }
}

/**
 * Turn what the orchestrator wrote into a plan waiting on the user.
 *
 * Steps land pending — nothing has run, and nothing will until the user says
 * so. The question this has to answer first is *which* plan the reply belongs
 * to, and the answer is in the turn it is replying to. A step that ran hands
 * its worker's report back as the orchestrator's next turn, so a reply to a
 * report is the orchestrator writing more of the plan that worker came from —
 * that is the loop the shapes are built around, and throwing away the steps
 * already approved would lose the thread.
 *
 * A reply to anything else starts a plan of its own. Asking for a second fix
 * while the first is still running is a second job, and the canvas used to
 * have nowhere to put it: the steps went onto the end of whatever plan was
 * live, under a shape chosen for a different question, until the count tripped
 * the mismatch warning and blamed the orchestrator for a merge the app had
 * done to it.
 */
function proposePlan(api: CanvasStore, fromNodeId: string, text: string) {
  const parsed = parsePlan(text)
  if (!parsed.length) return

  const steps: PlanStep[] = parsed.map((p) => ({
    id: `step_${uid()}`,
    persona: p.persona,
    task: p.task,
    state: 'pending',
  }))

  // The shape it chose for this job. Absent when it skipped the line, which
  // costs nothing: a plan with no shape runs in order, the safe reading.
  const chosen = parsePattern(text)

  // The shape belongs in the feed as much as on the plan: it is the decision
  // that explains why the next thing to happen is three agents rather than
  // one, and it is made before any of them exist.
  if (chosen) logPulse(api, fromNodeId, 'shape', `${chosen.id} — ${chosen.why}`)

  api.setState((s) => {
    const node = s.nodes.find((n) => n.id === fromNodeId)
    const mine = s.plans.filter((p) => p.fromNodeId === fromNodeId)

    // The turn this reply answers. A report in it names the worker that wrote
    // it, and that worker is a step of exactly one plan.
    const incoming =
      node && isSession(node)
        ? [...node.data.messages].reverse().find((m) => m.role === 'user')?.text
        : undefined
    const carry = planOfReply(s.plans, fromNodeId, incoming ?? '', (childId) => {
      const kid = s.nodes.find((n) => n.id === childId)
      return kid && isSession(kid) ? kid.data.name : undefined
    })

    if (carry) {
      // A plan grows every time the orchestrator writes again, and it writes
      // again after each step reports back. Nothing in that loop ends it on
      // its own — an agent asked to critique its own plan will happily keep
      // finding one more thing — so the ceiling is the app's, not the model's.
      if (carry.steps.length >= MAX_PLAN_STEPS) {
        noteOnNode(api, 
          fromNodeId,
          `This plan is already ${carry.steps.length} steps long, the limit. Approve or drop what's there, or start a fresh plan — a plan that keeps growing after every result is usually a loop rather than progress.`,
        )
        return s
      }
      const grown = [...carry.steps, ...steps].slice(0, MAX_PLAN_STEPS)
      const shape = chosen ?? carry.pattern
      return {
        plans: withPlan(s.plans, carry.id, (p) => ({
          ...p,
          // A later reply may re-shape the job it is still in the middle of —
          // that is the orchestrator-worker case, where what the work needs is
          // only clear once some of it has run.
          ...(chosen ? { pattern: chosen } : {}),
          ...mismatch(api, fromNodeId, shape?.id, grown.length, carry.goal),
          steps: grown,
        })),
      }
    }

    // A new track of work. Only live plans count against the ceiling: one that
    // has finished is a record on the canvas, not a job in flight, and making
    // the user clear their history to start something would be the wrong
    // lesson from a backstop.
    if (mine.filter((p) => planLive(p.steps)).length >= MAX_PLANS) {
      noteOnNode(api, 
        fromNodeId,
        `This agent already has ${MAX_PLANS} plans on the go, the limit. Finish or drop one before starting another — that many jobs at once from one orchestrator is usually a loop rather than progress.`,
      )
      return s
    }

    // What was asked for, so a plan still makes sense hours later. The report
    // that started a plan is not what was asked for, so a plan that grew out of
    // a hand-back never gets here — this is only ever a user's own words.
    const goal =
      node && isSession(node)
        ? (node.data.messages.filter((m) => m.role === 'user').at(-1)?.text ?? '')
        : ''
    return {
      plans: [
        ...s.plans,
        {
          id: `plan_${uid()}`,
          fromNodeId,
          goal: goal.slice(0, 240),
          steps,
          proposedAt: Date.now(),
          ...(chosen ? { pattern: chosen } : {}),
          ...mismatch(api, fromNodeId, chosen?.id, steps.length, goal),
        },
      ],
    }
  })
}

/**
 * Run one approved step. Marks it running while its agent works, then done or
 * failed — a plan that ran is a record of what happened, not a blank slate.
 */
async function runPlanStep(api: CanvasStore, fromNodeId: string, stepId: string, defer = false): Promise<string | null> {
  const patch = (fn: (s: PlanStep) => PlanStep) =>
    api.setState((s) => ({
      plans: s.plans.map((p) =>
        p.steps.some((st) => st.id === stepId)
          ? { ...p, steps: p.steps.map((st) => (st.id === stepId ? fn(st) : st)) }
          : p,
      ),
    }))

  const step = findStep(api.getState().plans, stepId)?.step
  if (!step || step.state !== 'pending') return null

  patch((st) => ({ ...st, state: 'running', error: undefined }))
  const result = await spawnChild(api, fromNodeId, step.persona, step.task, defer)
  patch((st) =>
    result.ok
      ? { ...st, state: 'done', childId: result.childId }
      : { ...st, state: 'failed', error: result.error },
  )
  return result.ok ? (result.report ?? null) : null
}

/**
 * Every pending step at once, then one turn carrying all of their results.
 *
 * This is the whole reason the shape is asked for. Four independent reviews
 * run sequentially cost four round trips of wall-clock for no benefit — none
 * of them was going to read the others — and four separate hand-backs cost
 * four orchestrator turns to read what one turn could read together.
 *
 * The steps are snapshotted before anything starts: the orchestrator writes
 * more steps as results arrive, and those belong to the next round, not this
 * one. Their agents are created synchronously inside `spawnChild` before it
 * awaits anything, so the per-agent and per-canvas limits still see each other
 * even though the turns overlap.
 */
async function runPlanFanout(api: CanvasStore, planId: string) {
  const plan = api.getState().plans.find((p) => p.id === planId)
  if (!plan) return
  const fromNodeId = plan.fromNodeId
  const approved = plan.steps.filter((st) => st.state === 'pending').map((st) => st.id)
  if (!approved.length) return

  // Every approved step runs — but no more than MAX_FANOUT of them are in
  // flight at once. Dropping the rest would be the app silently deciding the
  // user approved less than they did; running eight agents at once is the
  // spend this cap exists to bound. Waves are the only answer that does
  // neither.
  const reports: string[] = []
  for (let i = 0; i < approved.length; i += MAX_FANOUT) {
    const wave = approved.slice(i, i + MAX_FANOUT)
    const done = await Promise.all(wave.map((id) => runPlanStep(api, fromNodeId, id, true)))
    reports.push(...done.filter((r): r is string => !!r))
  }
  if (!reports.length) return

  // Still on the canvas? A user who deleted the orchestrator while its workers
  // ran has said what they think of the results.
  const parent = api.getState().nodes.find((n) => n.id === fromNodeId)
  if (!parent || parent.type !== 'session') return

  await useStore
    .getState()
    .send(
      fromNodeId,
      `${reports.length} steps of your plan ran at the same time. All of their reports:\n\n${reports.join('\n\n')}`,
    )
}

async function maybeDelegate(api: CanvasStore, fromNodeId: string, text: string) {
  // Same backtracking trap as SPAWN: require a non-space first character.
  const match = text.match(/^\s*DELEGATE\s+([\w.-]+)\s*:[ \t]*(\S.*)$/im)
  if (!match) return
  const [, targetName, task] = match

  // Without this, A delegates to B, B's answer prompts A to delegate again,
  // and the canvas bills you forever. Unlike a spawn chain this isn't nesting —
  // each hand-back is a fresh turn — so it can't be read off the graph. The
  // counter clears when it trips, which forces a pause in a ping-pong rather
  // than banning delegation outright.
  const chained = delegations.get(fromNodeId) ?? 0
  if (chained >= MAX_DELEGATE_CHAIN) {
    delegations.delete(fromNodeId)
    noteOnNode(api, 
      fromNodeId,
      `Stopped delegating after ${MAX_DELEGATE_CHAIN} hand-offs in a row — that usually means two agents are passing the same task back and forth. Say what you want done next.`,
    )
    return
  }
  delegations.set(fromNodeId, chained + 1)

  const s = api.getState()
  const from = s.nodes.find((n) => n.id === fromNodeId)
  const target = s.nodes.find(
    (n) => n.type === 'session' && n.data.name.toLowerCase() === targetName.toLowerCase(),
  )
  if (!from || !target || target.id === fromNodeId) return

  // Draw the transient call edge for the life of the call.
  const callId = `call_${uid()}`
  api.setState((st) => ({
    edges: [
      ...st.edges,
      { id: callId, source: fromNodeId, target: target.id, type: 'call', data: {} },
    ],
  }))

  await api.getState().send(target.id, task.trim())

  // Wait for the delegate to finish, then hand the answer back.
  await whenIdle(api, target.id)

  api.setState((st) => ({ edges: st.edges.filter((e) => e.id !== callId) }))

  const done = api.getState().nodes.find((n) => n.id === target.id)
  const answer =
    done && done.type === 'session' ? (done.data.messages.at(-1)?.text ?? '') : ''
  if (answer && from.type === 'session' && done?.type === 'session') {
    handOver(api, from.data.sessionId, done.data.sessionId)
    await useStore
      .getState()
      .send(fromNodeId, reportBlock(done.data.name, 'delegate', handBack(answer)))
  }
}

/**
 * Note that everything one agent has published has now reached another.
 *
 * A worker's reply lands on the shared bus *and* is handed straight back to
 * whoever asked for it, and the two agents are joined by a context edge — so
 * without this the parent received the same result twice: once as the report,
 * and again in the next turn's context block. The bus is right to hold it,
 * because a third agent watching this one has still not seen it; it is only
 * this reader that is already holding it.
 */
function handOver(api: CanvasStore, toSessionId: string, fromSessionId: string) {
  api.setState((s) => {
    const mine = s.bus.filter((e) => e.sessionId === fromSessionId).map((e) => e.id)
    if (!mine.length) return s
    return {
      delivered: {
        ...s.delivered,
        [toSessionId]: new Set([...(s.delivered[toSessionId] ?? []), ...mine]),
      },
    }
  })
}

/**
 * A handle on the store from the browser console, in dev builds only.
 *
 * The app normally runs inside Tauri, where the console is awkward to reach
 * and the interesting states — a squad mid-turn, an agent that failed, a full
 * context window — take real money and real minutes to reach. Under `vite dev`
 * the UI renders in an ordinary browser, and this makes those states one
 * `setState` away, which is how the canvas gets looked at while it is being
 * designed.
 *
 * Guarded on `import.meta.env.DEV`, so the whole block is dropped from a
 * production bundle rather than shipping a way to rewrite the graph.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { canvastrator?: unknown }).canvastrator = useStore
}
