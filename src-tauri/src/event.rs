use serde::{Deserialize, Serialize};

/// The provider-neutral event vocabulary. Every adapter's job is to turn its
/// CLI's JSONL dialect into a stream of these.
#[derive(Debug, Clone, Serialize, Deserialize)]
// `rename_all` renames variants; fields need `rename_all_fields` or the
// frontend silently reads `undefined` for every multi-word field.
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentEvent {
    /// The provider handed us the id we can later resume with.
    Started { provider_session_id: String },
    /// What this session can actually do, straight from its startup event.
    /// More reliable than scanning disk: it already accounts for plugins,
    /// project config, and anything the CLI decided to disable.
    Capabilities {
        skills: Vec<String>,
        commands: Vec<String>,
        /// Each MCP server the session loaded, and whether it connected.
        mcp_servers: Vec<McpStatus>,
        /// Fully-qualified MCP tool names, e.g. `mcp__flowiki__search`.
        mcp_tools: Vec<String>,
    },
    /// A chunk of assistant prose.
    TextDelta { text: String },
    /// Progress that isn't output: the provider retrying an overloaded API,
    /// waiting on a request, and so on. Without surfacing these, a slow turn
    /// is indistinguishable from a dead one.
    Notice {
        /// Short label for the node's status pill, e.g. "retry 3/10".
        label: String,
        /// Fuller explanation for the tooltip / transcript.
        detail: String,
    },
    /// The agent invoked a tool. `paths` is what the canvas turns into file
    /// nodes. Write-ness is per path, not per call: `cat a.md > b.md` reads one
    /// file and writes another, and marking both as written would claim the
    /// agent changed a file it only looked at.
    ToolCall {
        name: String,
        detail: String,
        paths: Vec<PathTouch>,
    },
    /// Terminal event for a turn that produced an answer.
    Result {
        text: String,
        cost_usd: Option<f64>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
        /// Everything the model read to produce this turn: fresh input plus
        /// whatever came from cache.
        ///
        /// Distinct from `input_tokens`, which is what was *billed at full
        /// rate* — on a cached conversation that is a few hundred tokens while
        /// the real prompt is a hundred thousand. Accumulating input_tokens
        /// answers "what did this cost"; this field answers "how full is the
        /// context window", and the two diverge by orders of magnitude the
        /// moment prompt caching is doing its job.
        context_tokens: Option<u64>,
    },
    /// Something went wrong; the turn is over.
    Failed { message: String },
    /// Process exited. Always the last event of a turn.
    Exited { code: i32 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PathTouch {
    pub path: String,
    pub write: bool,
}

/// Envelope pushed to the frontend over the `session://event` Tauri channel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    pub session_id: String,
    pub turn_id: String,
    pub seq: u64,
    pub event: AgentEvent,
}
