import type { Density } from './density'
import type { PatternChoice } from './patterns'

export type Provider = 'claude' | 'codex' | 'opencode'
export type Role = 'orchestrator' | 'worker'

/**
 * What a session may do without asking. A `--print` run can't answer a
 * permission prompt, so this must be set explicitly or every edit is refused.
 */
export type Permission = 'plan' | 'auto' | 'full'

/** The three, in the order the pickers cycle and list them. */
export const PERMISSIONS: Permission[] = ['plan', 'auto', 'full']

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

/** One selectable model: what the user reads, and what the CLI is sent. */
export type ModelOption = {
  /** Exactly the string handed to the CLI's `--model` flag. */
  id: string
  /** Human-readable name, shown instead of the id. */
  label: string
  /**
   * Roughly what this model is for: `heavy` for hard reasoning, `mid` for
   * ordinary implementation, `light` for cheap mechanical passes. Omitted
   * when the model has no honest place in that ordering — an opencode id
   * from a vendor we cannot rank against the others, say. Readers must cope
   * with it being unset rather than assume list order means anything.
   */
  tier?: ModelTier
  /** Short note on a model whose character the tier does not capture. */
  note?: string
  /**
   * How many tokens fit in this model's context window.
   *
   * Omitted where we have no authority for a number, which is most of the
   * opencode list — those ids point at whatever the user's own config resolves
   * them to. An omitted window is drawn as an unknown one, never guessed: a
   * meter that invents a denominator is worse than a meter that admits it does
   * not have one, because only the first is believed.
   */
  context?: number
}

/**
 * The models offered per provider — the one place they are defined. Every
 * picker, persona editor and default-resolution path reads from here.
 *
 * These are the ids each CLI is known to accept, but the field stays free
 * text: all three providers take `--model <string>` and pass it through, and
 * the set of models moves faster than this app ships. Unset is always
 * available and always the default — it means "whatever the CLI defaults to",
 * which follows the user's own provider config.
 */
export const MODEL_OPTIONS: Record<Provider, ModelOption[]> = {
  // `claude --help`: an alias for the latest model, or a full model name.
  // Full names, so a persona keeps running on the model it was written for.
  claude: [
    {
      id: 'claude-fable-5',
      label: 'Fable 5',
      note: 'built for creative and natural-language work, not raw reasoning depth',
      context: 1_000_000,
    },
    { id: 'claude-opus-5', label: 'Opus 5', tier: 'heavy', context: 1_000_000 },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', tier: 'mid', context: 1_000_000 },
    {
      id: 'claude-haiku-4-5-20251001',
      label: 'Haiku 4.5',
      tier: 'light',
      // The one current Claude model still on a 200K window.
      context: 200_000,
    },
  ],
  // The two presets the codex CLI ships with. It forwards anything else
  // straight to the API, which is why the field is not a closed list.
  codex: [
    { id: 'gpt-5', label: 'GPT-5', tier: 'heavy' },
    {
      id: 'gpt-5-codex',
      label: 'GPT-5 Codex',
      tier: 'heavy',
      note: 'the same size as gpt-5, tuned for coding and agentic edits',
    },
  ],
  // opencode names models `provider/model`, and which providers exist depends
  // on the user's own config — `opencode models` is the authority. These are
  // the flagships of the provider it ships signed in to.
  opencode: [
    {
      id: 'opencode/claude-fable-5',
      label: 'Fable 5',
      note: 'built for creative and natural-language work, not raw reasoning depth',
    },
    { id: 'opencode/claude-opus-5', label: 'Opus 5', tier: 'heavy' },
    { id: 'opencode/claude-sonnet-5', label: 'Sonnet 5', tier: 'mid' },
    { id: 'opencode/claude-haiku-4-5', label: 'Haiku 4.5', tier: 'light' },
    { id: 'opencode/gpt-5.5', label: 'GPT-5.5', tier: 'heavy' },
    {
      id: 'opencode/gpt-5.3-codex',
      label: 'GPT-5.3 Codex',
      tier: 'heavy',
      note: 'tuned for coding and agentic edits',
    },
    { id: 'opencode/gemini-3.1-pro', label: 'Gemini 3.1 Pro', tier: 'heavy' },
    // No tier: xAI's flagship, but we have no honest basis for ranking it
    // against the Anthropic, OpenAI and Google entries above it.
    { id: 'opencode/grok-4.6', label: 'Grok 4.6', note: "xAI's flagship" },
  ],
}

/**
 * The context window for a session, or null when we cannot say.
 *
 * Null is a real answer here and gets its own treatment in the UI. A session
 * on the CLI's default model has not told us which model that is, and an
 * opencode id resolves through the user's own config — inventing 200K for
 * either would put a confident denominator under a number that has none.
 */
export function contextLimit(provider: Provider, model?: string): number | null {
  if (!model) return null
  return (MODEL_OPTIONS[provider] ?? []).find((m) => m.id === model)?.context ?? null
}

/** What to type here, per provider. Shown when the field is empty. */
export const MODEL_HINT: Record<Provider, string> = {
  claude: 'a model id or alias, e.g. opus — blank for the CLI default',
  codex: 'a model id your codex CLI accepts — blank for the CLI default',
  opencode: 'provider/model, as `opencode models` lists it — blank for default',
}

/** The tiers a model can be preferred for, in the order they are offered. */
export const MODEL_TIERS = ['heavy', 'mid', 'light'] as const

export type ModelTier = (typeof MODEL_TIERS)[number]

/**
 * What the user wants the orchestrator reaching for when it invents a persona.
 *
 * The tier mapping in the orchestrator's brief is written from
 * `MODEL_OPTIONS`, which says what each tier is *for* — it cannot say which of
 * two heavy models this user is willing to pay for. That is a preference, not
 * a fact about the models, so it lives here and is set from the chatbox rather
 * than baked into the brief.
 *
 * Every field is nullable and null means "no preference": an unset canvas must
 * leave the orchestrator exactly the latitude it had before this existed.
 */
export type OrchestraPrefs = {
  /** The provider new agents should be spawned on, or null to let it choose. */
  provider: Provider | null
} & Record<ModelTier, string | null>

export const DEFAULT_ORCHESTRA: OrchestraPrefs = {
  provider: null,
  heavy: null,
  mid: null,
  light: null,
}

/**
 * The label for a model id, falling back to the id for anything unlisted —
 * including a provider we have no options for, which persisted canvases from
 * an older build can still carry.
 */
export function modelLabel(provider: Provider, id: string): string {
  return (MODEL_OPTIONS[provider] ?? []).find((m) => m.id === id)?.label ?? id
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
      /** The whole prompt this turn read, cache included. See `event.rs`. */
      contextTokens: number | null
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
  /**
   * Absolute paths of images sent with this message. Optional, and written
   * only when there are any — canvases saved before images existed must still
   * load, and a message without the field is simply a message without images.
   */
  images?: string[]
  /** Set while the assistant message is still being streamed into. */
  pending?: boolean
  error?: boolean
}

/**
 * One step of a plan: a persona, and what it should be asked to do.
 *
 * A step is a spawn that hasn't happened yet. It carries the id of the agent
 * it became so the plan can say what came of it after the fact, rather than
 * vanishing the moment it runs.
 */
export type PlanStep = {
  id: string
  persona: string
  task: string
  state: 'pending' | 'running' | 'done' | 'failed'
  /** The agent this step spawned, once it has run. */
  childId?: string
  /** Why it failed — an unknown persona, a limit, a dead provider. */
  error?: string
}

/**
 * Work the orchestrator proposed and the user hasn't agreed to yet.
 *
 * One plan at a time per canvas: a plan is the answer to "what are we doing",
 * and two of them competing is the state this is meant to prevent.
 */
export type Plan = {
  /** The orchestrator that wrote it. */
  fromNodeId: string
  /**
   * The shape it chose, and why.
   *
   * Optional because a plan written before the ladder existed, or by an agent
   * that skipped the line, is still a plan — it just runs in order, which is
   * what every shape but a fan-out does anyway.
   */
  pattern?: PatternChoice
  /**
   * Set when the shape it declared and the plan it wrote disagree.
   *
   * Kept on the plan rather than only shown once, because it is the reason the
   * plan will run in order despite what its shape says — and a user reading
   * the panel an hour later deserves that reason, not a silent demotion.
   */
  warning?: string
  /** What was asked for, so the plan still makes sense hours later. */
  goal: string
  steps: PlanStep[]
  proposedAt: number
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
  /** Set when the turn ended on a question, so the session is waiting on you. */
  awaitingUser?: boolean
  /** Skills and slash commands this session reported at startup. */
  skills?: string[]
  commands?: string[]
  /** MCP servers this session actually loaded, and how they fared. */
  mcpServers?: { name: string; status: string }[]
  mcpTools?: string[]
  /** Start of the turn in flight. Files touched since are the ones it's on. */
  turnStartedAt?: number
  permission: Permission
  /**
   * How much of this agent the node shows, when the user has said.
   *
   * Absent is the normal state and means "whatever the zoom asks for" — see
   * `density.ts`. It is only ever set by a deliberate act on the node, and
   * once set it survives any zoom, because a node you opened on purpose
   * closing itself because you zoomed out to look at something else is the
   * behaviour that makes a canvas feel like it is fighting you.
   */
  density?: Density
  /**
   * This agent's standing brief, prepended to every turn.
   *
   * Used to live on a separate personality node wired into the session. That
   * put the settings for one agent in two places on the canvas and cost a node
   * per agent, so it lives on the agent itself; the reusable *templates* are
   * the persona library, which needs no canvas presence at all.
   */
  instructions?: string
  /**
   * The brief as the agent last received it. Resending an unchanged brief every
   * turn is waste — the model already has it in history — but sending it only
   * once means editing it does nothing to a running agent, which defeats
   * putting it on the node. So it goes when it differs from this.
   */
  sentInstructions?: string
  /**
   * The set of folders as the agent last received it, normalized by
   * `folderSetKey` — the working directory, then the extras in sorted order.
   * Folders are usually wired in after a conversation has started, so the
   * block goes again whenever the set changes, and never twice unchanged. It
   * is the key rather than the rendered block because detaching and
   * reattaching a folder reorders the extras without changing the set.
   */
  sentFolders?: string
  /**
   * Blocks that used to ride on every single turn, and now go only when they
   * are new or have changed. Each holds the form of what was last sent, not
   * the text of it, so the comparison survives rewording.
   *
   * A resumed session already has these in its history — the provider is
   * given the conversation id and replays it — so re-sending them bought
   * nothing and was the largest repeated cost on the canvas.
   */
  /** Which orchestrator protocol this agent has: `run` or `plan`. */
  sentOrchestrator?: string
  /** The persona roster as last described, by `rosterKey`. */
  sentRoster?: string
  /** The delegable peers as last listed, by `peerKey`. */
  sentPeers?: string
  /** Files already examined elsewhere on the canvas, by `filesKnownKey`. */
  sentFilesKnown?: string
  /**
   * Digest of each attached file's contents as this agent last received them.
   * A file whose digest is unchanged is already in the agent's history, so
   * sending it again is paying twice for the same bytes.
   */
  sentFiles?: Record<string, string>
  /** The provider's own conversation id — how continuity survives a turn. */
  providerSessionId?: string
  messages: Message[]
  usage: { costUsd: number; inputTokens: number; outputTokens: number }
  /**
   * How much context the last turn carried.
   *
   * The last turn, not a running total: the conversation is resent whole every
   * turn, so this is the size of the thing itself rather than something to add
   * up. Absent until a turn reports it, which is why the meter can say
   * "unknown" rather than "empty".
   */
  contextTokens?: number
  skillIds: string[]
  /** Bumped to retrigger the "skill fired" flash. */
  firedAt?: number
}

/**
 * The readouts that float over the canvas rather than sitting on it.
 *
 * Pulse, Usage and the persona library were nodes and drawers, which made them
 * things you had to find: a node scrolls away with the canvas it is pinned to,
 * and a drawer covers the work while you read it. None of the three describes
 * anything *on* the canvas — they describe the canvas itself — so they live in
 * screen space now, stacked in the corner, untouched by pan or zoom.
 */
export type PanelKey = 'pulse' | 'usage' | 'personas'

/** Top to bottom, in the order they stack. */
export const PANEL_KEYS: readonly PanelKey[] = ['pulse', 'usage', 'personas']

/**
 * `open` is whether the panel is on screen at all; `minimized` is whether it
 * is showing as a header alone. They are separate because closing a panel must
 * not throw away how you had it — reopening puts back the panel you left.
 */
export type PanelState = { open: boolean; minimized: boolean }

export type Panels = Record<PanelKey, PanelState>

/**
 * Nothing open. The canvas is the point, and three panels over it on a first
 * run would be three things to dismiss before you can see it.
 */
export const DEFAULT_PANELS: Panels = {
  pulse: { open: false, minimized: false },
  usage: { open: false, minimized: false },
  personas: { open: false, minimized: false },
}

/**
 * The Landing module, as a node.
 *
 * Holds an id and nothing else, like the other two modules: the files it lists
 * are read off the canvas and the line counts off git, and a stored copy of
 * either would be a second version of what changed.
 */
export type LandingNodeData = { landingId: string }

/**
 * A real shell on the canvas.
 *
 * Holds an id and a name and nothing else. Whether a shell is actually running
 * is a fact about this run of the app — the process dies with it — so it is
 * asked for rather than stored; a restored node that claimed a live shell it
 * no longer has would be lying about the one thing you look at it for.
 */
export type TerminalNodeData = {
  terminalId: string
  name: string
  /** Set while a shell is up, for this run only. Never persisted. */
  running?: boolean
  /** How it ended, so a dead terminal says why rather than just going quiet. */
  exit?: { code: number | null }
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

/**
 * The shape a persona takes. No longer a node type — personas live in the
 * library and are edited on the agent they configure — but canvases saved
 * before that change still contain these, and the library still stores them.
 */
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
/**
 * One thing worth telling the user about, in a feed behind the bell.
 *
 * These used to be nodes on the canvas — one per finished turn, beside the
 * agent that produced it. A busy canvas then spent most of its area on a
 * history nobody was reading, and the nodes competed with the agents for
 * attention. A feed you open when you want it costs no canvas at all.
 */
/**
 * The kinds of thing the canvas records.
 *
 * `turn`, `question` and `error` are outcomes of a turn and are what the bell
 * shows. The rest are the surrounding story — what you asked for, what shape
 * the orchestrator chose, who it spawned, what got written — and exist so the
 * Pulse module can answer "what is going on" without you opening agents one
 * at a time. See `pulse.ts` for which kinds each surface admits.
 */
export type NotificationKind =
  | 'turn'
  | 'question'
  | 'error'
  | 'prompt'
  | 'shape'
  | 'spawned'
  | 'wrote'

export type Notification = {
  id: string
  /** The agent this is about, so clicking through opens the right chat. */
  sessionNodeId: string
  sessionName: string
  provider: Provider
  /** `question` is a turn that ended waiting on the user — the urgent kind. */
  kind: NotificationKind
  /** What happened, in the agent's own words where there are any. */
  headline: string
  /** Distinct tool names the turn used, in first-use order. */
  tools: string[]
  toolCount: number
  ts: number
  read: boolean
}

/**
 * Which drawer the rail is showing.
 *
 * `chat` names the retired docked chat panel. It stays in the union only
 * because a canvas saved while that panel was showing still carries the value;
 * nothing can select it any more, and the rail falls back rather than opening
 * an empty drawer under a highlighted button. The conversation lives in the
 * chatbox and, at full density, inside the agent's own node. The persona
 * library used to be a drawer here too — it is a floating panel now, so it has
 * no tab.
 */
export type RightTab = 'canvases' | 'decisions' | 'chat'

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
