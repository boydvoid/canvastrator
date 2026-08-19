export type Provider = 'claude' | 'codex' | 'opencode'
export type Role = 'orchestrator' | 'worker'

/**
 * What a session may do without asking. A `--print` run can't answer a
 * permission prompt, so this must be set explicitly or every edit is refused.
 */
export type Permission = 'plan' | 'auto' | 'full'

export const PERMISSION_LABEL: Record<Permission, string> = {
  plan: 'read-only',
  auto: 'auto',
  full: 'full access',
}

export const PERMISSION_HINT: Record<Permission, string> = {
  plan: 'Reads and explores. No edits, no commands.',
  auto: 'Edits files and runs commands (builds, tests), safety-checked by the provider.',
  full: 'No safety checks, no sandbox. Use only where the agent cannot do damage.',
}

/**
 * How hard the model thinks before answering. Optional everywhere: unset means
 * the CLI's own default, which follows the user's provider config.
 *
 * The ladder is claude's, since it has the widest one. Codex stops at `high`
 * and clamps the two rungs above it; opencode passes the level through to
 * whichever provider it is configured against.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const EFFORT_HINT: Record<Effort, string> = {
  low: 'Fast and shallow. Mechanical passes, renames, formatting.',
  medium: 'Ordinary implementation and review.',
  high: 'Hard reasoning: architecture, tricky debugging.',
  xhigh: 'Slower still. Use when high is not getting there.',
  max: 'Everything it has. Expensive — reserve for genuinely hard problems.',
}

/**
 * Model suggestions per provider. Every CLI takes `--model <string>` and the
 * set of models moves far faster than this app does, so the field is free
 * text — these are one-click shortcuts, never the whole list.
 */
export const MODEL_SUGGESTIONS: Record<Provider, string[]> = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: [],
  opencode: [],
}

/** What to type here, per provider. Shown when the field is empty. */
export const MODEL_HINT: Record<Provider, string> = {
  claude: 'opus · sonnet · haiku, or a full model id',
  codex: 'a model id your codex CLI accepts',
  opencode: 'a model as your opencode config names it',
}

export type SessionState =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'error'
  | 'dead'

/** One file an agent touched, and whether it changed it. */
export type PathTouch = { path: string; write: boolean }

/** Provider-neutral events emitted by the Rust side. */
export type AgentEvent =
  | { kind: 'started'; providerSessionId: string }
  | { kind: 'textDelta'; text: string }
  | { kind: 'notice'; label: string; detail: string }
  | {
      kind: 'capabilities'
      skills: string[]
      commands: string[]
      mcpServers: { name: string; status: string }[]
      mcpTools: string[]
    }
  | { kind: 'toolCall'; name: string; detail: string; paths: PathTouch[] }
  | {
      kind: 'result'
      text: string
      costUsd: number | null
      inputTokens: number | null
      outputTokens: number | null
    }
  | { kind: 'failed'; message: string }
  | { kind: 'exited'; code: number }

export type SessionEvent = {
  sessionId: string
  turnId: string
  seq: number
  event: AgentEvent
}

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  tools: { name: string; detail: string }[]
  /** Set while the assistant message is still being streamed into. */
  pending?: boolean
  error?: boolean
}

export type SessionNodeData = {
  sessionId: string
  provider: Provider
  role: Role
  name: string
  cwd: string
  model?: string
  effort?: Effort
  state: SessionState
  /** Provider progress that isn't output — e.g. "retry 3/10" while overloaded. */
  notice?: { label: string; detail: string }
  /** Skills and slash commands this session reported at startup. */
  skills?: string[]
  commands?: string[]
  /** MCP servers this session actually loaded, and how they fared. */
  mcpServers?: { name: string; status: string }[]
  mcpTools?: string[]
  /** Start of the turn in flight. Files touched since are the ones it's on. */
  turnStartedAt?: number
  permission: Permission
  /** The provider's own conversation id — how continuity survives a turn. */
  providerSessionId?: string
  messages: Message[]
  usage: { costUsd: number; inputTokens: number; outputTokens: number }
  skillIds: string[]
  /** Bumped to retrigger the "skill fired" flash. */
  firedAt?: number
}

/** A directory on the canvas. Wiring it to a session sets that session's cwd. */
export type FolderNodeData = {
  folderId: string
  path: string
  /** Missing directories must be visible, not a confusing spawn failure. */
  missing?: boolean
}

/**
 * A file on the canvas. Either dropped in by the user as context, or spawned
 * automatically when an agent touched it.
 */
export type FileNodeData = {
  fileId: string
  path: string
  /** How this node got here. */
  origin: 'user' | 'agent'
  /** Set when an agent wrote rather than read it. */
  written?: boolean
  bytes?: number
  preview?: string
  binary?: boolean
  error?: string
  touchedAt?: number
}

/**
 * A named agent archetype the orchestrator can instantiate on demand.
 *
 * The description is the load-bearing field: it's what the orchestrator reads
 * when deciding whether this personality fits the task, so a vague one makes
 * routing vague.
 */
/** A skill found on disk, under whichever provider's convention owns it. */
export type DiscoveredSkill = {
  name: string
  description: string
  provider: Provider
  /** "user", "project", or the plugin it came from. */
  source: string
  path: string
}

/** An MCP server as configured on this machine or defined on the canvas. */
export type McpServer = {
  name: string
  transport: string
  command?: string
  args?: string[]
  url?: string
  source: string
}

export type McpNodeData = McpServer & {
  mcpId: string
  /** Tools the session reported for this server, once it has run. */
  tools?: string[]
  /** Status from the session's startup event: connected / failed / needs-auth. */
  status?: string
}

/** One MCP tool an agent actually called. */
export type McpToolNodeData = {
  toolId: string
  server: string
  tool: string
  /** How many times it's been called on this canvas. */
  calls: number
  lastAt: number
}

export type PersonalityNodeData = {
  personalityId: string
  name: string
  /** When to use this personality — read by the orchestrator when routing. */
  description: string
  provider: Provider
  model?: string
  /** Reasoning effort, or unset for the provider's default. */
  effort?: Effort
  permission: Permission
  /** Injected as the child's opening instructions. */
  instructions: string
  /** Bumped when a child is spawned, to flash the node. */
  firedAt?: number
}

/**
 * What a session did on one turn, dropped on the canvas beside it when the
 * turn ends. Written by Canvastrator from the reply, not by the agent — so it
 * costs nothing and can't be skipped by an agent that forgot to summarise.
 */
export type SummaryNodeData = {
  summaryId: string
  /** The session node this is an account of. */
  sessionNodeId: string
  sessionName: string
  provider: Provider
  /** One line on what the turn did, in the agent's own words. */
  headline: string
  /** Distinct tool names the turn used, in first-use order. */
  tools: string[]
  toolCount: number
  ts: number
}

export type SkillTrigger = 'on-attach' | 'manual' | 'always'

export type SkillNodeData = {
  skillId: string
  name: string
  description: string
  trigger: SkillTrigger
  body: string
  firedAt?: number
}

/** One entry on the shared context bus. */
export type ContextEntry = {
  id: string
  sessionId: string
  sessionName: string
  kind: 'summary' | 'user' | 'error'
  body: string
  ts: number
}

export type ProviderStatus = {
  provider: Provider
  binary: string
  available: boolean
  path: string | null
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'opencode',
}

export const PROVIDER_ACCENT: Record<Provider, string> = {
  claude: 'var(--color-claude)',
  codex: 'var(--color-codex)',
  opencode: 'var(--color-opencode)',
}
