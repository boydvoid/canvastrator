import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { CanvasDoc, CanvasMeta } from './persist'
import type {
  DiscoveredSkill,
  McpServer,
  Effort,
  Permission,
  Provider,
  ProviderStatus,
  SessionEvent,
} from './types'

export const detectProviders = () => invoke<ProviderStatus[]>('detect_providers')

export const defaultCwd = () => invoke<string>('default_cwd')

export const sendTurn = (req: {
  sessionId: string
  provider: Provider
  cwd: string
  prompt: string
  resume: string | null
  model: string | null
  effort: Effort | null
  permission: Permission
  mcpServers: McpServer[]
  /** Absolute paths; how images reach a CLI, which takes no image bytes. */
  images: string[]
  /** Operations this canvas refuses to let the agent take unasked. */
  guards: string[]
}) => invoke<string>('send_turn', { req })

/** One operation the canvas knows how to hold back. */
export type GuardRule = { id: string; what: string }

/** Every guard the app can enforce, for the settings list. */
export const guardRules = () => invoke<GuardRule[]>('guard_rules')

/** Let one agent past one guard, from its next attempt on. */
export const guardAllow = (sessionId: string, rule: string) =>
  invoke<void>('guard_allow', { sessionId, rule })

/** Take that approval back. */
export const guardRevoke = (sessionId: string, rule: string) =>
  invoke<void>('guard_revoke', { sessionId, rule })

/** What this agent has been allowed so far. */
export const guardAllowed = (sessionId: string) =>
  invoke<string[]>('guard_allowed', { sessionId })

export const interruptSession = (sessionId: string) =>
  invoke<void>('interrupt_session', { sessionId })

export const pickPath = (directory: boolean) =>
  invoke<string | null>('pick_path', { directory })

export type FilePeek = { text: string; bytes: number; truncated: boolean; binary: boolean }

export const readFileHead = (path: string, maxBytes = 24_000) =>
  invoke<FilePeek>('read_file_head', { path, maxBytes })

export type TextFile = { text: string; bytes: number; truncated: boolean }

export const readTextFile = (path: string, maxBytes: number) =>
  invoke<TextFile>('read_text_file', { path, maxBytes })

export const writeTextFile = (path: string, contents: string) =>
  invoke<void>('write_text_file', { path, contents })

export const readBinaryBase64 = (path: string, maxBytes: number) =>
  invoke<{ base64: string; bytes: number }>('read_binary_base64', { path, maxBytes })

export const fileExists = (path: string) => invoke<boolean>('file_exists', { path })

export type FileStamp = { bytes: number; mtimeMs: number }

/**
 * Size and mtime, or `null` when the path isn't there. For a file whose
 * contents never enter the app — an image goes to the provider by path — this
 * is the only thing there is to digest, and the null doubles as the existence
 * check.
 */
export const fileStamp = (path: string) => invoke<FileStamp | null>('file_stamp', { path })

/**
 * Park a pasted image under the system temp dir and hand back its absolute
 * path. Never inside the user's repo: a stray PNG there shows up in `git
 * status` and in the agent's own file listings.
 */
export const writeSessionImage = (sessionId: string, base64: string, mime: string) =>
  invoke<string>('write_session_image', { sessionId, base64, mime })

/** Drop one pasted image: the thumbnail was removed, or the paste was never sent. */
export const removeSessionImage = (sessionId: string, path: string) =>
  invoke<void>('remove_session_image', { sessionId, path })

/** Drop a session's pasted images. Its node is gone; nothing will resume onto them. */
export const clearSessionImages = (sessionId: string) =>
  invoke<void>('clear_session_images', { sessionId })

/** Skills the user already has installed, for any provider. */
export const discoverSkills = (cwd: string | null) =>
  invoke<DiscoveredSkill[]>('discover_skills', { cwd })

export type ProjectFile = { rel: string; path: string; root: string }

/** Files under the folder nodes a session can reach. */
export const listProjectFiles = (roots: string[], query: string, limit = 40) =>
  invoke<ProjectFile[]>('list_project_files', { roots, query, limit })

/** MCP servers already configured on this machine. */
export const discoverMcpServers = (cwd: string | null) =>
  invoke<McpServer[]>('discover_mcp_servers', { cwd })

export type DiffBase = { original: string | null; reason: string | null; rel: string | null }

/** The committed version of a file, to diff the working copy against. */
export const fileDiffBase = (path: string) => invoke<DiffBase>('file_diff_base', { path })

/** One metered window of a Claude plan, as `plan_usage` flattens it. */
export type UsageWindow = { kind: string; label: string; percent: number; resetsAt: string | null }

export type PlanUsage = {
  available: boolean
  subscription: string | null
  windows: UsageWindow[]
  reason: string | null
}

/**
 * What the user's Claude plan has left.
 *
 * Costs no tokens — it is the same control request that backs the CLI's own
 * `/usage` view — but it does spawn a process, so callers poll it on a timer
 * rather than on every render.
 */
export const planUsage = () => invoke<PlanUsage>('plan_usage')

/** What the project's own check said about an agent's work. */
export type CheckResult = {
  ok: boolean
  code: number | null
  ms: number
  tail: string
  /** Set when the check could not run at all, as opposed to failing. */
  error: string | null
}

/** Run a canvas's check command in a directory and report the verdict. */
export const runCheck = (cwd: string, command: string) =>
  invoke<CheckResult>('run_check', { cwd, command })

/** What this project's check probably is — a guess, for the user to accept. */
export const detectCheck = (cwd: string) => invoke<string | null>('detect_check', { cwd })

/** One checkout of a repository — the main one, or an agent's own. */
export type Worktree = { path: string; branch: string; repo: string; created: boolean }

/** The repository root a path sits in, or null outside one. */
export const gitRepoRoot = (path: string) => invoke<string | null>('git_repo_root', { path })

/**
 * Give an agent its own checkout. Idempotent: isolating twice lands back on
 * the existing one rather than making a second.
 */
export const worktreeAdd = (path: string, name: string) =>
  invoke<Worktree>('worktree_add', { path, name })

/** Every checkout of the repository a path belongs to. */
export const worktreeList = (path: string) => invoke<Worktree[]>('worktree_list', { path })

/** Remove a checkout. Refuses while it holds uncommitted work — never forced. */
export const worktreeRemove = (path: string) => invoke<void>('worktree_remove', { path })

/** The branch a path sits on, or null for a detached HEAD or no repo at all. */
export const gitBranch = (path: string) => invoke<string | null>('git_branch', { path })

export const dirExists = (path: string) => invoke<boolean>('dir_exists', { path })

export const listCanvases = () => invoke<CanvasMeta[]>('list_canvases')

export const loadCanvasDoc = (id: string) => invoke<CanvasDoc>('load_canvas', { id })

export const saveCanvasDoc = (doc: CanvasDoc) => invoke<void>('save_canvas', { doc })

/** Write a handover note beside the canvases, and return where it landed. */
export const writeNote = (name: string, text: string) =>
  invoke<string>('write_note', { name, text })

export const deleteCanvasDoc = (id: string) => invoke<void>('delete_canvas', { id })

export const onSessionEvent = (handler: (e: SessionEvent) => void) =>
  listen<SessionEvent>('session://event', (e) => handler(e.payload))

/**
 * The terminal nodes' shells. One per node id, living in Rust so a build keeps
 * running while you look at something else.
 */
export const terminalOpen = (terminalId: string, cwd: string, cols: number, rows: number) =>
  invoke<boolean>('terminal_open', { terminalId, cwd, cols, rows })

export const terminalWrite = (terminalId: string, data: string) =>
  invoke<void>('terminal_write', { terminalId, data })

export const terminalResize = (terminalId: string, cols: number, rows: number) =>
  invoke<void>('terminal_resize', { terminalId, cols, rows })

export const terminalClose = (terminalId: string) =>
  invoke<void>('terminal_close', { terminalId })

/** Which shells this run of the app actually has. */
export const terminalLive = () => invoke<string[]>('terminal_live')

export type TerminalChunk = { terminalId: string; data: string }
export type TerminalExit = { terminalId: string; code: number | null }

export const onTerminalData = (fn: (c: TerminalChunk) => void) =>
  listen<TerminalChunk>('terminal://data', (e) => fn(e.payload))

export const onTerminalExit = (fn: (e: TerminalExit) => void) =>
  listen<TerminalExit>('terminal://exit', (e) => fn(e.payload))
