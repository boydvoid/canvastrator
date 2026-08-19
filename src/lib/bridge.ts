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
}) => invoke<string>('send_turn', { req })

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

export const dirExists = (path: string) => invoke<boolean>('dir_exists', { path })

export const listCanvases = () => invoke<CanvasMeta[]>('list_canvases')

export const loadCanvasDoc = (id: string) => invoke<CanvasDoc>('load_canvas', { id })

export const saveCanvasDoc = (doc: CanvasDoc) => invoke<void>('save_canvas', { doc })

export const deleteCanvasDoc = (id: string) => invoke<void>('delete_canvas', { id })

export const onSessionEvent = (handler: (e: SessionEvent) => void) =>
  listen<SessionEvent>('session://event', (e) => handler(e.payload))
