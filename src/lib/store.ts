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
import { dirExists, fileExists, interruptSession, readFileHead, sendTurn } from './bridge'
import { looksLikeQuestion } from './asking'
import { boxOf, FILE_SIZE, findFreeSpot, layoutCanvas, SESSION_SIZE, sizeOf } from './layout'
import { parsePersonaDefinitions } from './persona-parse'
import { summarizeTurn } from './summary'
import {
  dedupeByName,
  loadLibrary,
  saveLibrary,
  STARTER_PERSONAS,
  type Persona,
} from './library'
import {
  MODEL_OPTIONS,
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
  Message,
  ModelOption,
  Permission,
  Provider,
  ProviderStatus,
  SessionNodeData,
  SkillNodeData,
  SkillTrigger,
  Notification,
} from './types'

export type CanvasDialog = 'open' | 'save-as' | 'rules'

export type GtNode =
  | (Node<SessionNodeData> & { type: 'session' })
  | (Node<SkillNodeData> & { type: 'skill' })
  | (Node<FolderNodeData> & { type: 'folder' })
  | (Node<FileNodeData> & { type: 'file' })
  | (Node<McpNodeData> & { type: 'mcp' })
  | (Node<McpToolNodeData> & { type: 'mcptool' })

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
  rightTab: 'chat' | 'personas'
  /** Session node the chat panel is pointed at. Falls back to the orchestrator. */
  chatTarget: string | null

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
  addFile: (path: string, pos: { x: number; y: number }, origin?: 'user' | 'agent') => string
  addMcp: (server: McpServer, pos: { x: number; y: number }) => string
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
  queued: Record<string, string[]>
  /**
   * Sessions whose in-flight turn is being abandoned and re-run, keyed to the
   * prompt to replay. Set when a setting that only takes effect at turn start
   * — effort — changes mid-turn.
   */
  restarting: Record<string, string>
  /** Hand a node back to the user — called when they drag it. */
  claimNode: (id: string) => void
  toggleAutoTidy: () => void
  updateSkill: (nodeId: string, patch: Partial<SkillNodeData>) => void
  removeNode: (id: string) => void
  renameSession: (nodeId: string, name: string) => void
  setPermission: (nodeId: string, permission: Permission) => void
  setModel: (nodeId: string, model?: string) => void
  /** Undefined is "unset" — fall back to the provider's own default. */
  setEffort: (nodeId: string, effort?: Effort) => void
  /** This agent's standing brief, prepended to every turn. */
  setInstructions: (nodeId: string, instructions: string) => void
  setRightTab: (t: 'chat' | 'personas') => void
  setChatTarget: (nodeId: string | null) => void

  setCanvasDialog: (d: CanvasDialog | null) => void
  setGlobalRules: (rules: string) => void

  send: (nodeId: string, text: string) => Promise<void>
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

/** `mcp__flowiki__search` → { server: 'flowiki', tool: 'search' } */
export function parseMcpTool(name: string): { server: string; tool: string } | null {
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/)
  return m ? { server: m[1], tool: m[2] } : null
}

/**
 * Folder nodes a session may search. The graph is the boundary here as
 * everywhere else: a directory that isn't on the canvas cannot be reached,
 * whatever the session's cwd happens to be.
 */
export function searchRootsFor(nodes: GtNode[], edges: Edge[], sessionNodeId: string): string[] {
  return edges
    .filter((e) => e.target === sessionNodeId && (e.type === 'cwd' || e.type === 'attach'))
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is GtNode & { type: 'folder' } => !!n && isFolder(n) && !n.data.missing)
    .map((n) => n.data.path)
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
  autoTidy: true,
  autoPlaced: new Set<string>(),
  notifications: [],
  queued: {},
  restarting: {},

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) as GtNode[] })),

  onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

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
      // A folder wired into a session IS that session's cwd. Only one may be,
      // so a new one replaces the old rather than silently competing.
      if (isFolder(source) && isSession(target)) {
        const withoutOldCwd = s.edges.filter(
          (e) => !(e.target === target.id && e.type === 'cwd'),
        )
        return { edges: addEdge({ ...conn, type: 'cwd' }, withoutOldCwd) }
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
    void readFileHead(path)
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

  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      // Drop the dock's pointer too. The panel already falls back to the
      // orchestrator, but leaving a dead id around invites confusion later.
      chatTarget: s.chatTarget === id ? null : s.chatTarget,
    })),

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
      set((s) => ({ restarting: { ...s.restarting, [nodeId]: replay.text } }))
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

  send: async (nodeId, text) => {
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
        queued: { ...st.queued, [nodeId]: [...(st.queued[nodeId] ?? []), text] },
      }))
      return
    }
    const d = node.data

    // 0. The folder node wired into this session is its working directory.
    const cwd = resolveCwd(s.nodes, s.edges, nodeId)
    if (!cwd) {
      set((st) => ({
        nodes: st.nodes.map((n) =>
          n.id === nodeId && isSession(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  messages: [
                    ...n.data.messages,
                    {
                      id: uid(),
                      role: 'system' as const,
                      text: 'No folder attached. Wire a folder node into this session to give it a working directory.',
                      tools: [],
                      error: true,
                    },
                  ],
                },
              }
            : n,
        ) as GtNode[],
      }))
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

    const fileBlocks: string[] = []
    let fileBudget = FILE_BUDGET_CHARS
    for (const f of attachedFiles) {
      if (fileBudget <= 0) break
      try {
        const peek = await readFileHead(f.data.path, Math.min(fileBudget, 24_000))
        if (peek.binary) continue
        const body = peek.text.slice(0, fileBudget)
        fileBudget -= body.length
        fileBlocks.push(
          `<canvastrator-file path="${f.data.path}"${peek.truncated ? ' truncated="true"' : ''}>\n${body}\n</canvastrator-file>`,
        )
      } catch {
        fileBlocks.push(`<canvastrator-file path="${f.data.path}" error="unreadable" />`)
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
    // This agent's standing brief, when it is new or has been edited since.
    const brief = (d.instructions ?? '').trim()
    const briefChanged = brief !== (d.sentInstructions ?? '').trim()
    if (brief && briefChanged) {
      parts.push(`<canvastrator-role>\n${brief}\n</canvastrator-role>`)
    }

    if (fileBlocks.length) {
      parts.push(fileBlocks.join('\n'))
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
    // 3b. Everything this session may instantiate: personality nodes wired
    // into it, plus the persona library, which is available everywhere.
    const roster = rosterFor(s.library)
    if (d.role === 'orchestrator') {
      const list = roster.length
        ? roster
            .map(
              (p) =>
                `- ${p.name} (${p.provider}${p.model ? `/${p.model}` : ''}${p.effort ? `, ${p.effort} effort` : ''}, ${p.permission}) — ${p.description}`,
            )
            .join('\n')
        : '(none yet)'

      parts.push(
        [
          '<canvastrator-orchestrator>',
          'You are the orchestrator of a canvas of agents. Your job is to route work, not to perform it.',
          '',
          'Do the work yourself ONLY when it is trivial: a direct question about this conversation, a one-line clarification, or deciding what to do next. Anything that involves reading a codebase, writing or changing files, running commands, designing, reviewing, or research goes to a specialist — even when you could do it. A task you complete yourself is a task the user cannot see, re-run, or reassign.',
          '',
          'Available personas:',
          list,
          '',
          'To run one, put this in your reply:',
          'SPAWN <persona-name>: <the task, stated fully enough to act on without further context>',
          '',
          'The task may run over several paragraphs — everything after the colon belongs to it, to the end of your reply. So put any commentary of your own BEFORE the SPAWN line, never after it.',
          '',
          'If none of the available personas is a good fit, INVENT ONE FIRST. Do not force a bad fit, and do not fall back to doing it yourself. Define it with a fenced block, then spawn it in the same reply:',
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
          'SPAWN api-designer: Design the /sessions endpoint for …',
          '',
          'Choosing the fields:',
          '- provider: claude, codex, or opencode.',
          `- model: match the model to the work, using the mapping below — it is explicit, so never infer rank from the order of a list. Use one of the ids the chosen provider takes, or omit it to take the provider default.\n${MODEL_GUIDE}`,
          '- effort: how hard it should think. low for mechanical passes, medium for ordinary implementation and review, high for architecture and hard debugging, xhigh or max only for genuinely difficult problems — they are slow and expensive. Omit it and the persona runs at medium.',
          '- permission: plan for anything read-only (review, research, design), auto when it must edit files or run commands, full only when it genuinely needs an unsandboxed machine.',
          '- description: when a future orchestrator should reach for this. It is the only thing routing sees, so make it specific.',
          '',
          'A persona you define is saved to the user\'s library and reusable on every canvas, so define it as a lasting role, not a one-off errand. Name it for the role, never for the specific task.',
          '',
          'If this turn carries a <canvas-global-rules> block, those rules are the user\'s and they bind you. They also bind everyone you spawn: Canvastrator gives each new agent the same block, and you must restate anything task-specific from it in the SPAWN text you write.',
          '</canvastrator-orchestrator>',
        ].join('\n'),
      )
    }
    if (peers.length && d.role === 'orchestrator') {
      parts.push(
        `<canvastrator-agents>\nOther agents you can delegate to:\n${peers
          .map((p) => `- ${p.data.name} (${p.data.provider})`)
          .join('\n')}\n\nTo delegate, put a line in your reply of exactly this form:\nDELEGATE <agent-name>: <the task>\nCanvastrator will run it on that agent and report back. Only delegate when it genuinely helps.\n</canvastrator-agents>`,
      )
    }
    parts.push(text)
    const prompt = parts.join('\n\n')

    // 4. Optimistic UI: user turn in, assistant placeholder streaming.
    const userMsg: Message = { id: uid(), role: 'user', text, tools: [] }
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
        patchNode((d) => ({ ...d, providerSessionId: ev.providerSessionId }))
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
          setTimeout(() => void get().send(nodeId, replay), 0)
          break
        }

        // Anything typed while this session was busy goes now, in order.
        const waiting = get().queued[nodeId] ?? []
        if (waiting.length) {
          set((st) => ({ queued: { ...st.queued, [nodeId]: waiting.slice(1) } }))
          setTimeout(() => void get().send(nodeId, waiting[0]), 0)
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
          const entry: ContextEntry = {
            id: uid(),
            sessionId,
            sessionName: author && isSession(author) ? author.data.name : sessionId,
            kind: 'summary',
            body: last.text.replace(/\s+/g, ' ').slice(0, 600),
            ts: Date.now(),
          }
          set((s) => ({ bus: [...s.bus, entry] }))
          // …and into the bell, so a turn that finished while you were looking
          // somewhere else is still there when you come back.
          notifyTurn(nodeId, last, looksLikeQuestion(last.text))
          // Definitions first: a reply can invent a persona and spawn it in
          // the same breath, and the spawn resolves against the library.
          void maybeDefinePersonas(last.text).then(() => {
            void maybeDelegate(nodeId, last.text)
            void maybeSpawn(nodeId, last.text)
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
  const { personality: personalityName, task } = parsed

  const st = useStore.getState()
  const parent = st.nodes.find((n) => n.id === fromNodeId)
  if (!parent || parent.type !== 'session') return

  const roster = rosterFor(st.library)
  const persona = roster.find((p) => p.name.toLowerCase() === personalityName.toLowerCase())
  if (!persona) {
    const known = roster.map((p) => p.name).join(', ')
    noteOnNode(
      fromNodeId,
      `Couldn't spawn "${personalityName}" — no persona by that name.` +
        (known ? ` Available: ${known}.` : ' The persona library is empty.'),
    )
    return
  }

  if (spawnDepth(st.edges, fromNodeId) >= MAX_SPAWN_DEPTH) {
    noteOnNode(
      fromNodeId,
      `Couldn't spawn "${persona.name}" — already ${MAX_SPAWN_DEPTH} levels deep in spawned agents. Ask the orchestrator to run this itself, or start it from the top.`,
    )
    return
  }

  // Per agent. This used to count every spawn edge on the canvas, so after six
  // spawns in the canvas's whole life every later spawn was refused in silence.
  const myChildren = st.edges.filter((e) => e.type === 'spawn' && e.source === fromNodeId).length
  if (myChildren >= MAX_CHILDREN_PER_AGENT) {
    noteOnNode(
      fromNodeId,
      `Couldn't spawn "${persona.name}" — this agent already has ${myChildren} children, the limit. Delete some from the canvas to make room.`,
    )
    return
  }

  const sessionCount = st.nodes.filter((n) => n.type === 'session').length
  if (sessionCount >= MAX_SESSIONS) {
    noteOnNode(
      fromNodeId,
      `Couldn't spawn "${persona.name}" — the canvas is at its limit of ${MAX_SESSIONS} agents.`,
    )
    return
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

  const parentCwdEdge = st.edges.find((e) => e.target === fromNodeId && e.type === 'cwd')

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
      // Same working directory as its parent, or it has nowhere to run.
      ...(parentCwdEdge
        ? [{ id: `cwd_${uid()}`, source: parentCwdEdge.source, target: childId, type: 'cwd' }]
        : []),
    ],
  }))

  // The brief rides on the child's own `instructions`, which `send` injects —
  // prepending it here as well would send it twice.
  await useStore.getState().send(childId, task)

  await whenIdle(childId)

  const done = useStore.getState().nodes.find((n) => n.id === childId)
  const answer = done && done.type === 'session' ? (done.data.messages.at(-1)?.text ?? '') : ''
  if (answer) {
    await useStore
      .getState()
      .send(
        fromNodeId,
        name === persona.name
          ? `${name} reported:\n\n${answer}`
          : `${name} (a ${persona.name}) reported:\n\n${answer}`,
      )
  }
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
  if (answer) {
    await useStore
      .getState()
      .send(fromNodeId, `${targetName} completed the delegated task and reported:\n\n${answer}`)
  }
}
