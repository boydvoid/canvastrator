import { create } from 'zustand'
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
  sendTurn,
  terminalClose,
} from './bridge'
import { forgetEmulator } from './terminals'
import { digest, readShared } from './filecache'
import { attachableImage } from './filekind'
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
import { nextStep, parsePlan, planLive } from './plan'
import { summarizeTurn } from './summary'
import {
  dedupeByName,
  loadLibrary,
  saveLibrary,
  STARTER_PERSONAS,
  type Persona,
} from './library'
import {
  DEFAULT_ORCHESTRA,
  MODEL_OPTIONS,
  MODEL_TIERS,
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
  UsageNodeData,
  TerminalNodeData,
  Message,
  ModelOption,
  OrchestraPrefs,
  Permission,
  Plan,
  PlanStep,
  Provider,
  ProviderStatus,
  SessionNodeData,
  SkillNodeData,
  SkillTrigger,
  Notification,
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
  | (Node<UsageNodeData> & { type: 'usage' })
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

type State = {
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
  /** The right dock: chat with an agent, or browse personas. */
  libraryOpen: boolean
  rightTab: 'chat' | 'personas' | 'decisions'
  /** Session node the chat panel is pointed at. Falls back to the orchestrator. */
  chatTarget: string | null

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
  openFile: (path: string | null) => void

  addSession: (provider: Provider, pos: { x: number; y: number }) => string
  /** Start an agent configured by a library persona. */
  addSessionFromPersona: (persona: Persona, pos: { x: number; y: number }) => string
  addSkill: (pos: { x: number; y: number }, seed?: Partial<SkillNodeData>) => string
  addFolder: (path: string, pos: { x: number; y: number }) => string
  /**
   * Give a session another folder to reach. Reuses a folder node already on
   * the canvas for that path rather than adding a second one for the same
   * directory. Returns the folder node's id, or null when it was already wired
   * into this session.
   */
  attachFolder: (sessionNodeId: string, path: string) => string | null
  /** Unwire a folder from a session. The node stays — it may feed others. */
  detachFolder: (sessionNodeId: string, folderNodeId: string) => void
  /** Make an attached folder the working directory, demoting the incumbent. */
  setPrimaryFolder: (sessionNodeId: string, folderNodeId: string) => void
  addFile: (path: string, pos: { x: number; y: number }, origin?: 'user' | 'agent') => string
  addMcp: (server: McpServer, pos: { x: number; y: number }) => string
  /**
   * The usage panel. One per canvas — a second copy of the same live figures
   * would be two things to move and nothing extra to read — so this returns
   * the existing one when there is one.
   */
  addUsage: (pos: { x: number; y: number }) => string
  /**
   * A shell on the canvas. Several are fine — one per thing you are watching —
   * unlike the usage panel, which has nothing to distinguish two copies.
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
  togglePlanning: () => void
  /** The plan waiting on the user, if there is one. */
  plan: Plan | null
  editPlanStep: (stepId: string, task: string) => void
  removePlanStep: (stepId: string) => void
  discardPlan: () => void
  /** Run one step now. Resolves when the agent it spawns has finished. */
  approvePlanStep: (stepId: string) => Promise<void>
  /** Run every step still pending, in order. */
  approvePlan: () => Promise<void>
  updateSkill: (nodeId: string, patch: Partial<SkillNodeData>) => void
  removeNode: (id: string) => void
  renameSession: (nodeId: string, name: string) => void
  setPermission: (nodeId: string, permission: Permission) => void
  setModel: (nodeId: string, model?: string) => void
  /** Undefined is "unset" — fall back to the provider's own default. */
  setEffort: (nodeId: string, effort?: Effort) => void
  /** This agent's standing brief, prepended to every turn. */
  setInstructions: (nodeId: string, instructions: string) => void
  setRightTab: (t: 'chat' | 'personas' | 'decisions') => void
  setChatTarget: (nodeId: string | null) => void

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
    .filter((x): x is { edge: Edge; node: GtNode & { type: 'folder' } } => !!x.node && isFolder(x.node))
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

export const useStore = create<State>((set, get) => ({
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
  rightTab: 'chat',
  chatTarget: null,
  orchestra: { ...DEFAULT_ORCHESTRA },
  autoTidy: true,
  // On by default. An orchestrator that spawns the moment it has an idea is
  // the behaviour this exists to make optional, not the one to default to.
  planning: true,
  plan: null,
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
  openFile: (openFilePath) => set({ openFilePath }),

  addSession: (provider, pos) => {
    const id = `node_${uid()}`
    const sessionId = `sess_${uid()}`
    const existing = get().nodes.filter(isSession).length
    const role = existing === 0 ? 'orchestrator' : 'worker'
    const node: GtNode = {
      id,
      type: 'session',
      position: pos,
      // One size for every agent: the node is an identifier, and the work it
      // is doing is read in the panel rather than inside the node.
      width: SESSION_SIZE.w,
      height: SESSION_SIZE.h,
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

  addFolder: (path, pos) => {
    const id = `node_${uid()}`
    set((s) => ({
      nodes: [
        ...s.nodes,
        { id, type: 'folder', position: pos, data: { folderId: `dir_${uid()}`, path } },
      ],
      selectedId: id,
    }))
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

  attachFolder: (sessionNodeId, path) => {
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

  editPlanStep: (stepId, task) =>
    set((s) =>
      s.plan
        ? {
            plan: {
              ...s.plan,
              steps: s.plan.steps.map((st) => (st.id === stepId ? { ...st, task } : st)),
            },
          }
        : s,
    ),

  removePlanStep: (stepId) =>
    set((s) => {
      if (!s.plan) return s
      const steps = s.plan.steps.filter((st) => st.id !== stepId)
      // A plan with every step struck out is a discarded plan.
      return { plan: steps.length ? { ...s.plan, steps } : null }
    }),

  discardPlan: () => set({ plan: null }),

  approvePlanStep: async (stepId) => {
    const plan = get().plan
    const step = plan?.steps.find((x) => x.id === stepId)
    if (!plan || !step || step.state !== 'pending') return
    await runPlanStep(plan.fromNodeId, stepId)
  },

  approvePlan: async () => {
    // A fan-out is the one shape where the steps do not read each other, which
    // is the only thing that makes running them at once safe — and it is the
    // orchestrator that said so, in the PATTERN line, before the user approved
    // the plan it was written under.
    const plan0 = get().plan
    if (plan0 && fansOut(plan0.pattern?.id) && !plan0.warning) return runPlanFanout(plan0.fromNodeId)

    // Otherwise one at a time, in order. The steps of a plan are a sequence —
    // a reviewer reads what the implementer wrote — and running them at once
    // would hand every one of them the state from before any of them ran.
    for (;;) {
      const plan = get().plan
      if (!plan) return
      const step = nextStep(plan.steps)
      if (!step) return
      await runPlanStep(plan.fromNodeId, step.id)
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
      const placed = layoutCanvas(s.nodes, s.edges, all ? undefined : s.autoPlaced)
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

  addUsage: (pos) => {
    const existing = get().nodes.find((n) => n.type === 'usage')
    if (existing) return existing.id
    const id = `node_${uid()}`
    set((s) => ({
      nodes: [
        ...s.nodes,
        { id, type: 'usage', position: pos, data: { usageId: `usage_${uid()}` } } as GtNode,
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

    // 2. Context reachable over inbound context edges, minus what we've sent.
    const inbound = s.edges
      .filter((e) => e.target === nodeId && e.type === 'context')
      .map((e) => s.nodes.find((n) => n.id === e.source))
      .filter((n): n is GtNode & { type: 'session' } => !!n && isSession(n))
    const sourceIds = new Set(inbound.map((n) => n.data.sessionId))
    const already = s.delivered[d.sessionId] ?? new Set<string>()
    const fresh = s.bus.filter((e) => sourceIds.has(e.sessionId) && !already.has(e.id))

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
          if (mcp) void recordMcpUse(nodeId, mcp.server, mcp.tool)
        }
        // Every file the agent touches becomes a node wired back to it, so the
        // canvas ends up showing what each agent actually worked on.
        for (const t of ev.paths) {
          void spawnTouchedFile(nodeId, absolute(t.path, node.data.cwd), t.write)
        }
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
          notifyTurn(nodeId, last, looksLikeQuestion(last.text))
          // Definitions first: a reply can invent a persona and spawn it in
          // the same breath, and the spawn resolves against the library.
          void maybeDefinePersonas(last.text).then(() => {
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
              proposePlan(nodeId, last.text)
            } else {
              void maybeDelegate(nodeId, last.text)
              void maybeSpawn(nodeId, last.text)
            }
          })
        }
        break
      }
    }
  },
}))

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
async function spawnTouchedFile(sessionNodeId: string, path: string, write: boolean) {
  // Paths pulled out of a shell command are guesses. Confirm the file is real
  // before it becomes a node — and give a write a moment to land, since the
  // tool call is reported before the command runs.
  if (!(await fileExists(path))) {
    await new Promise((r) => setTimeout(r, 900))
    if (!(await fileExists(path))) return
  }

  const st = useStore.getState()
  const session = st.nodes.find((n) => n.id === sessionNodeId)
  if (!session) return

  const existing = st.nodes.find((n) => n.type === 'file' && n.data.path === path)
  if (existing) {
    // Already on canvas: just refresh its state and make sure it's connected.
    useStore.setState((s) => ({
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

  const id = useStore.getState().addFile(path, pos, 'agent')
  markAutoPlaced(id)
  useStore.setState((s) => ({
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
function notifyTurn(sessionNodeId: string, msg: Message, awaitingUser: boolean) {
  const st = useStore.getState()
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
  useStore.setState((s) => ({
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
async function recordMcpUse(sessionNodeId: string, server: string, tool: string) {
  const st = useStore.getState()
  const session = st.nodes.find((n) => n.id === sessionNodeId)
  if (!session) return

  // 1. The server node.
  let serverNode = st.nodes.find((n) => isMcp(n) && n.data.name === server)
  if (!serverNode) {
    const reported = session.type === 'session'
      ? session.data.mcpServers?.find((m) => m.name === server)
      : undefined
    const id = useStore.getState().addMcp(
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
        useStore.getState().nodes.map(boxOf),
      ),
    )
    markAutoPlaced(id)
    if (reported) {
      useStore.setState((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isMcp(n) ? { ...n, data: { ...n.data, status: reported.status } } : n,
        ) as GtNode[],
      }))
    }
    serverNode = useStore.getState().nodes.find((n) => n.id === id)
  }
  if (!serverNode) return

  // Wire it to the agent that used it, if it isn't already.
  useStore.setState((s) => ({
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
    useStore.setState((s) => ({
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
    useStore.getState().nodes.map(boxOf),
  )
  useStore.setState((s) => ({
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
  markAutoPlaced(id)
}

/**
 * Resolve when a session is no longer mid-turn.
 *
 * `subscribe` only fires on change, so subscribing to a session that is already
 * idle waits forever — which is exactly what happened when the turn failed to
 * start at all (no folder attached, say). The parent then never got its report
 * and simply stopped, with nothing in the transcript to say why.
 */
function whenIdle(nodeId: string): Promise<void> {
  const busy = (s: ReturnType<typeof useStore.getState>) => {
    const n = s.nodes.find((x) => x.id === nodeId)
    return !!n && n.type === 'session' && (n.data.state === 'thinking' || n.data.state === 'streaming')
  }
  if (!busy(useStore.getState())) return Promise.resolve()
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
function markAutoPlaced(id: string) {
  useStore.setState((s) => ({ autoPlaced: new Set(s.autoPlaced).add(id) }))
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

/**
 * How long one plan may get.
 *
 * A plan accumulates: the orchestrator writes more steps every time a result
 * comes back, and the evaluator-optimizer shape *is* that loop on purpose.
 * Without a ceiling in the app, "revise until it is good" has no end that
 * anyone but the user pays for.
 */
const MAX_PLAN_STEPS = 24

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
function noteOnNode(nodeId: string, text: string) {
  useStore.setState((s) => ({
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
async function maybeDefinePersonas(text: string) {
  const defined = parsePersonaDefinitions(text)
  if (!defined.length) return

  const current = useStore.getState().library
  const known = new Set(current.map((p) => p.name.trim().toLowerCase()))
  // An existing name is left alone: redefining "reviewer" mid-conversation
  // would silently rewrite a persona the user tuned themselves.
  const fresh = defined.filter((p) => !known.has(p.name.trim().toLowerCase()))
  if (!fresh.length) return

  await useStore.getState().setLibrary([...current, ...fresh])
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

async function maybeSpawn(fromNodeId: string, text: string) {
  const parsed = parseSpawn(text)
  if (!parsed) return
  await spawnChild(fromNodeId, parsed.personality, parsed.task)
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
async function spawnChild(
  fromNodeId: string,
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
    noteOnNode(fromNodeId, error)
    return { ok: false, error }
  }

  const st = useStore.getState()
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

  const childId = useStore.getState().addSession(persona.provider, pos)
  markAutoPlaced(childId)
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

  useStore.setState((s) => ({
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

  // The brief rides on the child's own `instructions`, which `send` injects —
  // prepending it here as well would send it twice.
  await useStore.getState().send(childId, task)

  await whenIdle(childId)

  const done = useStore.getState().nodes.find((n) => n.id === childId)
  const answer = done && done.type === 'session' ? (done.data.messages.at(-1)?.text ?? '') : ''
  if (answer && done?.type === 'session') {
    // The child's whole reply used to be spliced into the parent's context.
    // It is written for the user — it reads files aloud and shows its working —
    // so the parent paid for all of that to find the one paragraph it needed.
    // Its REPORT block is what travels; the rest stays on the child's node.
    handOver(parent.data.sessionId, done.data.sessionId)
    const report = reportBlock(name, persona.name, handBack(answer))
    if (defer) return { ok: true, childId, report }
    await useStore.getState().send(fromNodeId, report)
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
function mismatch(
  fromNodeId: string,
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
    noteOnNode(fromNodeId, complaint)
    return { warning: complaint }
  }
  if (!id) return {}
  const complaint = checkShape(id, count)
  if (!complaint) return {}
  noteOnNode(fromNodeId, complaint)
  return { warning: complaint }
}

/**
 * Turn what the orchestrator wrote into a plan waiting on the user.
 *
 * Steps land pending — nothing has run, and nothing will until the user says
 * so. A reply that arrives while a plan is still live adds to it rather than
 * replacing it: the orchestrator writes again after each step reports back,
 * and throwing away the steps already approved would lose the thread.
 */
function proposePlan(fromNodeId: string, text: string) {
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

  useStore.setState((s) => {
    const carry = s.plan && s.plan.fromNodeId === fromNodeId && planLive(s.plan.steps) ? s.plan : null
    if (carry) {
      // A plan grows every time the orchestrator writes again, and it writes
      // again after each step reports back. Nothing in that loop ends it on
      // its own — an agent asked to critique its own plan will happily keep
      // finding one more thing — so the ceiling is the app's, not the model's.
      if (carry.steps.length >= MAX_PLAN_STEPS) {
        noteOnNode(
          fromNodeId,
          `This plan is already ${carry.steps.length} steps long, the limit. Approve or drop what's there, or start a fresh plan — a plan that keeps growing after every result is usually a loop rather than progress.`,
        )
        return s
      }
      const grown = [...carry.steps, ...steps].slice(0, MAX_PLAN_STEPS)
      const shape = chosen ?? carry.pattern
      return {
        plan: {
          ...carry,
          // A later reply may re-shape the job it is still in the middle of —
          // that is the orchestrator-worker case, where what the work needs is
          // only clear once some of it has run.
          ...(chosen ? { pattern: chosen } : {}),
          ...mismatch(fromNodeId, shape?.id, grown.length, carry.goal),
          steps: grown,
        },
      }
    }

    const node = s.nodes.find((n) => n.id === fromNodeId)
    // What was asked for, so a plan still makes sense hours later.
    const goal =
      node && isSession(node)
        ? (node.data.messages.filter((m) => m.role === 'user').at(-1)?.text ?? '')
        : ''
    return {
      plan: {
        fromNodeId,
        goal: goal.slice(0, 240),
        steps,
        proposedAt: Date.now(),
        ...(chosen ? { pattern: chosen } : {}),
        ...mismatch(fromNodeId, chosen?.id, steps.length, goal),
      },
    }
  })
}

/**
 * Run one approved step. Marks it running while its agent works, then done or
 * failed — a plan that ran is a record of what happened, not a blank slate.
 */
async function runPlanStep(fromNodeId: string, stepId: string, defer = false): Promise<string | null> {
  const patch = (fn: (s: PlanStep) => PlanStep) =>
    useStore.setState((s) =>
      s.plan
        ? { plan: { ...s.plan, steps: s.plan.steps.map((st) => (st.id === stepId ? fn(st) : st)) } }
        : s,
    )

  const step = useStore.getState().plan?.steps.find((x) => x.id === stepId)
  if (!step || step.state !== 'pending') return null

  patch((st) => ({ ...st, state: 'running', error: undefined }))
  const result = await spawnChild(fromNodeId, step.persona, step.task, defer)
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
async function runPlanFanout(fromNodeId: string) {
  const approved = (useStore.getState().plan?.steps ?? [])
    .filter((st) => st.state === 'pending')
    .map((st) => st.id)
  if (!approved.length) return

  // Every approved step runs — but no more than MAX_FANOUT of them are in
  // flight at once. Dropping the rest would be the app silently deciding the
  // user approved less than they did; running eight agents at once is the
  // spend this cap exists to bound. Waves are the only answer that does
  // neither.
  const reports: string[] = []
  for (let i = 0; i < approved.length; i += MAX_FANOUT) {
    const wave = approved.slice(i, i + MAX_FANOUT)
    const done = await Promise.all(wave.map((id) => runPlanStep(fromNodeId, id, true)))
    reports.push(...done.filter((r): r is string => !!r))
  }
  if (!reports.length) return

  // Still on the canvas? A user who deleted the orchestrator while its workers
  // ran has said what they think of the results.
  const parent = useStore.getState().nodes.find((n) => n.id === fromNodeId)
  if (!parent || parent.type !== 'session') return

  await useStore
    .getState()
    .send(
      fromNodeId,
      `${reports.length} steps of your plan ran at the same time. All of their reports:\n\n${reports.join('\n\n')}`,
    )
}

async function maybeDelegate(fromNodeId: string, text: string) {
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
    noteOnNode(
      fromNodeId,
      `Stopped delegating after ${MAX_DELEGATE_CHAIN} hand-offs in a row — that usually means two agents are passing the same task back and forth. Say what you want done next.`,
    )
    return
  }
  delegations.set(fromNodeId, chained + 1)

  const s = useStore.getState()
  const from = s.nodes.find((n) => n.id === fromNodeId)
  const target = s.nodes.find(
    (n) => n.type === 'session' && n.data.name.toLowerCase() === targetName.toLowerCase(),
  )
  if (!from || !target || target.id === fromNodeId) return

  // Draw the transient call edge for the life of the call.
  const callId = `call_${uid()}`
  useStore.setState((st) => ({
    edges: [
      ...st.edges,
      { id: callId, source: fromNodeId, target: target.id, type: 'call', data: {} },
    ],
  }))

  await useStore.getState().send(target.id, task.trim())

  // Wait for the delegate to finish, then hand the answer back.
  await whenIdle(target.id)

  useStore.setState((st) => ({ edges: st.edges.filter((e) => e.id !== callId) }))

  const done = useStore.getState().nodes.find((n) => n.id === target.id)
  const answer =
    done && done.type === 'session' ? (done.data.messages.at(-1)?.text ?? '') : ''
  if (answer && from.type === 'session' && done?.type === 'session') {
    handOver(from.data.sessionId, done.data.sessionId)
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
function handOver(toSessionId: string, fromSessionId: string) {
  useStore.setState((s) => {
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
