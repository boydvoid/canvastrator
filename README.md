# Canvastrator

A canvas-based orchestrator for terminal AI coding agents. Spawn Claude Code, Codex,
and opencode sessions as nodes on an infinite canvas, wire context between them, and
let the orchestrator delegate work to the others.

**Status: working proof of concept.** The core loop is real — sessions spawn actual
CLI processes, stream tokens back, keep their conversation across turns, share context
over edges, and delegate work to each other.

```bash
bun install
bun run tauri:dev      # development
bun run tauri build    # macOS .app + .dmg
```

The release bundle lands at `src-tauri/target/release/bundle/macos/Canvastrator.app`
(plus a `.dmg` alongside it). It's ad-hoc signed, so it opens from Finder on the machine
that built it without a Gatekeeper prompt.

Right-click the canvas → **Folder…** to pick a directory, then **Session ▸ Claude**.
The folder node *is* the session's working directory — wire it in, and that's where
the agent runs.

---

## What works

| | |
| --- | --- |
| **Session nodes** | Right-click → spawn Claude / Codex / opencode. Unavailable CLIs are greyed out, detected at startup. |
| **Folder nodes** | A directory on the canvas. Wire it into a session to set that session's cwd. One folder can drive several sessions; a session with no folder refuses to run rather than defaulting somewhere surprising. |
| **File nodes** | Wire a file into a session to inject its contents as context (budget-capped, re-read fresh each turn). |
| **Files map themselves** | When an agent reads or writes a file, a file node appears wired back to that agent — green edge for a write, dashed grey for a read. The canvas becomes a live picture of who touched what. |
| **Real streaming** | Token-level deltas from the CLI's JSONL stream into the node's transcript. |
| **Progress notices** | When the provider's API is overloaded and the CLI is backing off, the node shows `retry 3/10` with the reason. Silence during a 40-second backoff is indistinguishable from a hung agent. |
| **Session continuity** | Each turn is a fresh process resumed via the provider's own session id, so conversations persist. |
| **Tool visibility** | Tool calls appear inline in the transcript as they happen. |
| **Cost + tokens** | Tracked per session and totalled on the canvas. |
| **Interrupt** | Kills the in-flight turn. |
| **File viewer / editor** | Click a file node to open it: Monaco for code, a plain text box for `.txt`, inline rendering for images and PDFs. Edit and save with ⌘S. |
| **Canvas autosave** | The graph, transcripts, context bus, and watermarks are written to disk as you work — debounced, atomic, and starting from the first node rather than waiting for a manual save. Reopens where you left off. |
| **Switch canvases** | Click the canvas name in the top bar: every saved canvas is listed with its node count — one click to switch. Rename, Save-a-copy and New live in the same menu. |
| **Permissions** | Per-session badge in the header, cycling read-only → auto → full. Defaults to **auto**, so agents can edit files *and* run their build. |
| **Shared context** | Wire session → session; the target receives the source's turn summaries injected into its next prompt, watermarked so nothing is delivered twice. |
| **Persona library** | A right sidebar of reusable agent archetypes, saved to disk outside any canvas. Every orchestrator can spawn them; spawning one drops its node onto the canvas. Ships with reviewer / implementer / investigator / researcher. |
| **Personality nodes** | Named agent archetypes — provider, model, permission tier, and an opening brief. Wire one into an orchestrator and that orchestrator may instantiate it on demand. |
| **Orchestrator spawns children** | `SPAWN <personality>: <task>` creates a real new session in the same folder, wired for context both ways, runs the task, and reports back. |
| **Shape before spawn** | The orchestrator declares which of six orchestration shapes the job has — single agent, chain, routing, parallel, orchestrator-worker, evaluator-optimizer — cheapest that fits, and says why not the cheaper one. The plan panel shows the choice, and a plan that says its steps are independent actually runs them at once. |
| **Spawn policy via skills** | A skill on the orchestrator says *when* to spawn — "if the user asks for a poem, spawn the haiku-writer" — so routing is something you define, not something hardcoded. |
| **Agent → agent delegation** | The orchestrator can hand a task to another agent, get the answer back, and continue. Hop-limited. |
| **Skill nodes** | Write instructions, pick a trigger, wire to a session; they're injected into that agent. |
| **Motion** | Every animation encodes a state — breathing border = thinking, travelling dashes = context moving, fast pulse = a live agent→agent call. Honors `prefers-reduced-motion`. |

## Architecture

```
React (canvas, chat, zustand)
   │  invoke()          ▲ session://event
   ▼                    │
Tauri commands (Rust) ──┴─ SessionRegistry
   │
   ▼
claude / codex / opencode  ← one process per turn, JSONL on stdout
```

**Key finding from the Phase 0 spike:** all three CLIs expose structured JSONL
streaming *and* session resume, so Canvastrator needs **no PTY and no ANSI parsing**.
This is far cheaper than the design notes originally assumed.

| CLI | Streaming | Resume |
| --- | --- | --- |
| `claude` | `--print --output-format stream-json --include-partial-messages` | `--session-id` / `--resume` |
| `codex` | `exec --json` | `exec resume <thread>` |
| `opencode` | `run --format json` | `run --session <id>` |

Each turn is a **fresh process**. The conversation lives in the CLI's own store and is
picked back up by id. Simpler and more robust than holding a long-lived interactive
process, at the cost of per-turn startup.

### Choosing the shape of a job

A canvas of agents makes fan-out the easy move, and that is the trap: a squad
can spend an order of magnitude more tokens than one agent doing the same job.
So the orchestrator is made to choose first, from a ladder of six shapes with
the cost of each rung stated (`src/lib/patterns.ts`), and open its reply with:

```
PATTERN parallel: the three reviews never read each other's output.
PLAN reviewer: …
```

The declaration is read, not just displayed. `parallel` is the one shape whose
steps do not read each other, so approving that plan starts every pending step
at once and feeds all of their reports back in **one** orchestrator turn rather
than one turn each. Every other shape runs a step at a time, in order, each
seeing what the last one produced — which is also what a plan with no
declaration does, because in-order is the reading that can't be wrong.

Two ceilings live in the app rather than in the prompt: a plan stops growing at
24 steps, and spawn depth, children per agent, and sessions per canvas are
capped as before. "Revise until it's good" has no end that the model pays for.

### Layout

```
src-tauri/src/
  event.rs       provider-neutral AgentEvent vocabulary
  providers.rs   one adapter per CLI: argv + JSONL → AgentEvent   (unit tested)
  session.rs     spawn, stream, interrupt
  lib.rs         Tauri commands
src/
  Canvas.tsx           React Flow surface + context menu
  lib/store.ts         graph, context bus, turn lifecycle, delegation
  lib/types.ts         shared vocabulary
  components/nodes/    SessionNode (chat) · SkillNode · FolderNode · FileNode
  components/edges.tsx context · attach · call · cwd · file
```

### Working directories and files

A session's cwd is **not a setting** — it's whichever folder node is wired into it,
resolved from the graph at send time. Rewire the edge and the next turn runs elsewhere.
A session with no folder edge refuses the turn with a visible message rather than
silently spawning in `$HOME`.

File nodes go both directions:

- **user → agent**: wire a file into a session and its contents are read fresh and
  injected each turn, capped at 12k chars across all attached files.
- **agent → canvas**: tool calls carry structured `paths`, so any file an agent reads or
  writes materialises as a node connected to it (capped at 10 per session so a busy
  agent can't bury the canvas). Only real path arguments count — a `Bash` command
  string never becomes a file node.

### Opening files

Clicking a file node opens it in an overlay, routed by extension:

| Kind | Opened with |
| --- | --- |
| code (`.ts`, `.rs`, `.py`, `Dockerfile`, unknown extensions…) | Monaco, syntax-highlighted, editable |
| plain text (`.txt`, `.log`, `.csv`) | a plain textarea — a code editor is the wrong tool here |
| images (`.png`, `.jpg`, `.svg`, `.webp`…) | rendered inline |
| `.pdf` | rendered inline |
| known binaries (`.zip`, `.dylib`, `.mp4`…) | refused with a note, rather than megabytes of noise |

⌘S saves, Esc closes. Two guards worth noting:

- Files over 2 MB load truncated, and a **truncated file is forced read-only** — saving
  it would silently delete everything past the cut.
- `write_text_file` refuses paths that aren't already files, so the editor can only ever
  modify something a node already points at.

Monaco is **self-hosted, not CDN-loaded** — a desktop app shouldn't need the network to
open a file. Its workers are bundled via Vite `?worker` imports.

### Canvas persistence

**Format: one JSON file per canvas**, at
`~/Library/Application Support/com.canvastrator.app/canvases/<id>.json`
(the platform app-data dir). Written temp-then-rename, so an interrupted save can't leave
a half-written file. Ids are validated before becoming filenames, so nothing can escape
the directory.

```json
{
  "id": "canvas_50xcwt9e",
  "name": "my-squad",
  "updatedAt": 1787069599477,
  "version": 1,
  "data": {
    "nodes": [{ "id": "node_x", "type": "session", "position": { "x": 0, "y": 0 },
                "width": 400, "height": 320, "data": { "...": "..." } }],
    "edges": [{ "id": "cwd_1", "source": "node_f", "target": "node_x", "type": "cwd" }],
    "bus": [],
    "delivered": {},
    "cwd": "/Users/you"
  }
}
```

The envelope (`id`, `name`, `updatedAt`, `version`) is all the Rust side parses, so the
switcher can list canvases without the UI opening every file. `version` exists so a
future shape change can migrate rather than fail. `data` is owned entirely by the
frontend. Plain JSON on purpose: greppable, diffable, and hand-editable if something
goes wrong.

Autosave is debounced 1.2s — long enough that a streaming turn doesn't write a file per
token. **A canvas with content saves itself from the first node**, without waiting for a
manual ⌘S; requiring an explicit first save would leave everything before it losable,
which defeats the point. An empty canvas still writes nothing.

What's saved: node geometry and data (including transcripts and each session's provider
session id, so conversations resume after a restart), edges, the context bus, and the
delivery watermarks. What's deliberately dropped:

- React Flow's `selected` / `dragging` / `measured`, so a canvas can't restore mid-drag
- transient `call` edges and edge animation timestamps
- edges whose endpoints are gone
- `thinking` / `streaming` session state — the process died with the app, so a restored
  session would spin forever. `error` is a real outcome and survives.

Loading is deliberately forgiving: a file that lost a node opens with what's left rather
than refusing to open.

**Autosave never writes an empty graph over a saved canvas.** Reaching zero nodes is far
more often a bug or a mis-click than an edit worth persisting, and the file is the only
copy. An explicit save still goes through, and "Clear canvas" detaches from the file
instead of emptying it.

### The bundled app and PATH

**A GUI app launched from Finder or the Dock does not inherit your shell PATH** — it gets
`/usr/bin:/bin:/usr/sbin:/sbin` from launchd. That breaks Canvastrator twice over: `claude`
lives in `~/.local/bin` and can't be found, and any agent that does spawn can't run
`cargo`, `bun`, or `git` either. Both failures look like the app is broken rather than
mis-configured.

So on startup Canvastrator asks the login shell what PATH it would give (`$SHELL -lic`),
unions it with the inherited PATH and the usual install dirs, and uses that for both
provider detection and every spawned child. Providers are spawned by **absolute path**,
never by bare name.

Verified by running the test suite under `env -i PATH=/usr/bin:/bin`, where all three
CLIs still resolve, and by reading the installed app's log after a launchd launch:

```
[INFO] provider claude -> /Users/you/.local/bin/claude
[INFO] provider codex -> /opt/homebrew/bin/codex
[INFO] provider opencode -> /Users/you/.opencode/bin/opencode
```

That log is at `~/Library/Logs/com.canvastrator.app/canvastrator.log` and is enabled in release
builds too — when a provider shows as "not installed", it tells you whether PATH
resolution or the install is at fault.

### Using Canvastrator to build Canvastrator

It works, with one caveat: **the running app is a copy.** Agents edit the repo, but the
app you're using was built from an earlier state, so:

1. Point a folder node at the repo and let agents work normally.
2. To pick up their changes, quit Canvastrator, `bun run tauri build`, replace the installed
   app, and relaunch — you can't overwrite a running bundle.
3. Don't run `bun run tauri:dev` and the installed app at once. Both autosave to the same
   `canvases/` directory and the last write wins.

### Why a turn can look dead

The single most confusing failure in this app was a turn that produced nothing and then
reported `` `claude` exited with code 130 ``. Two separate defects, both ours:

1. **Dropped progress events.** The provider emits `system/api_retry` when the API returns
   529 and it backs off — up to 10 attempts with delays reaching ~40s. The adapter only
   handled `system/init`, so those were discarded and the node sat on "thinking" with no
   explanation. Now they surface as a `retry n/max` pill with the reason in the tooltip.
2. **Interrupt masquerading as a crash.** Killing a turn from the stop button reported
   itself as exit code 130, identical to a genuine crash. Interrupt is now tracked
   separately: a stopped turn keeps whatever text arrived and reports nothing as an error.

If a turn still says nothing, `~/Library/Logs/com.canvastrator.app/canvastrator.log` records the
full argv, cwd, permission tier, exit status, whether it was interrupted, and stderr.

### Permissions

A `--print` run cannot answer a permission prompt, so an unset policy means every edit
is silently refused — the agent replies "grant me write access" and looks broken. Each
session therefore carries an explicit mode, shown as a badge in its header:

| Canvastrator | claude | codex | opencode |
| --- | --- | --- | --- |
| `read-only` | `--permission-mode plan` | `--sandbox read-only` | *(no `--auto`)* |
| `auto` *(default)* | `--permission-mode auto` | `--full-auto` | `--auto` |
| `full access` | `--permission-mode bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` | `--auto` |

**Why `auto` and not `acceptEdits`:** `acceptEdits` only auto-approves file writes plus a
few filesystem commands (`mkdir`, `touch`, `mv`, `cp`). Anything else — `cargo build`,
`bun install`, `git init` — is denied outright, and in a non-interactive run there is no
prompt to approve, so the agent reports "every build command was auto-denied" and looks
broken. `auto` approves tool calls against the provider's own safety classifier instead,
which is the behaviour that makes an agent useful without handing it the whole machine.

`full access` is opt-in and rendered in the danger colour — it disables the safety checks
and the sandbox entirely.

⚠️ **`full access` is not verified end-to-end.** Every attempt to run a turn under
`bypassPermissions` so far has failed to complete, while `auto` completed the same prompt
in ~3s. The runs were also hitting 529 backoff, so the mode and the overload can't be
cleanly separated yet — but until that's untangled, **use `auto`**, which is the default
and is verified working in the bundled app.

### Context bus

Each completed turn appends a `ContextEntry` to a canvas-wide log. When a session
takes its next turn, entries reachable over its inbound `context` edges — minus a
per-pair watermark — are rendered into a `<canvastrator-context>` block and prepended to
the prompt. Budget-capped; the graph is the permission boundary.

### The orchestrator routes, it doesn't work

The orchestrator is told plainly that its job is routing, and that doing the work itself
is the failure mode:

> Do the work yourself ONLY when it is trivial… Anything that involves reading a
> codebase, writing or changing files, running commands, designing, reviewing, or
> research goes to a specialist — even when you could do it. A task you complete
> yourself is a task the user cannot see, re-run, or reassign.

**If nothing in the roster fits, it invents a persona rather than forcing a bad fit or
quietly doing the job.** It writes a fenced definition and spawns it in the same reply:

````
```canvastrator-persona
name: copywriter
provider: claude
model: sonnet
permission: plan
description: Writes short-form original text — poems, taglines, release notes.
---
You write short original copy. Return the piece and nothing else.
```
SPAWN copywriter: Write a haiku about grids
````

It's guided on each field, **including the model**: opus for hard reasoning and
architecture, sonnet for ordinary implementation and review, haiku for cheap mechanical
passes; `plan` for read-only roles, `auto` when it must edit or run things. A defined
persona is saved to the library and reusable everywhere, so it's told to name a lasting
role rather than a one-off errand.

An invented persona never overwrites an existing name — redefining "reviewer" mid-
conversation would silently rewrite one you tuned yourself.

Verified: with a library of four coding roles and the prompt "Write me a haiku about
grids", the orchestrator replied *"A haiku is a deliverable, not a clarification, so it
goes to a specialist. None of the four personas write prose or verse, so here's one:"*,
defined `copywriter` (`model: sonnet`, `permission: plan`), spawned it, and the child
process ran with `--model sonnet --permission-mode plan`. The persona is now in the
library.

### The persona library

Personalities defined on a canvas die with it, which makes a good "reviewer"
un-reusable. The **library** is the palette: personas saved to
`~/Library/Application Support/com.canvastrator.app/personalities.json`, edited in the right
sidebar, available on every canvas.

The library is deliberately available **without wiring**. Re-attaching "reviewer" on
every new canvas would defeat the point of having a library. The canvas still ends up
as the record of what happened: **spawning a library persona drops its node onto the
canvas**, wired to the orchestrator that used it. A personality node on the canvas wins
a name clash, so a canvas can override a library persona locally.

Names are the address — `SPAWN reviewer:` — so the library holds **one persona per
name**; a duplicate would make spawning silently ambiguous.

First run seeds four starters (reviewer, implementer, investigator, researcher). They're
ordinary entries: edit or delete them and they stay gone.

### Personalities and spawning

A **personality** is a named agent archetype: provider, optional model, permission tier,
a description, and an opening brief. It's a node, so it's part of the canvas and saved
with it.

Wiring a personality into a session grants that session the right to instantiate it —
the graph is the permission boundary here as everywhere else. The orchestrator's prompt
then carries the roster:

```
<canvastrator-personalities>
You can create new agents from these personalities:
- haiku-writer (claude) — Writes short poems. Use for any poetry or verse request.

To create one and hand it a task, put a line in your reply of exactly this form:
SPAWN <personality-name>: <the task>
</canvastrator-personalities>
```

When it emits that line, Canvastrator creates a **real new session node** carrying the
personality's provider, model and permission tier, places it below its parent, and wires
it up: a `spawn` edge for lineage, context edges both ways, and the parent's folder as
its cwd. The brief becomes its opening instructions, the task follows, and the answer is
fed back into the parent's conversation.

**The description is the load-bearing field** — it's what the orchestrator reads when
deciding what fits the task, so a vague one makes routing vague.

#### Deciding *when* to spawn

That's what skills are for. A skill wired into the orchestrator is just injected
instructions, which is exactly the right shape for a routing policy:

> If the user asks for a poem, do NOT write it yourself. Spawn the haiku-writer
> personality and give it the request.

Verified end to end: with that skill and that personality attached, "Please give me a
poem about grids" made the orchestrator emit `SPAWN haiku-writer: …`; a new session
appeared running under the personality's `plan` permission (not the default `auto`),
produced a haiku, and the orchestrator resumed with the answer.

Guards: a personality must be wired in to be spawnable, spawning is hop-limited like
delegation, and a canvas stops at 6 spawned children.

### Delegation

An orchestrator with outgoing context edges is told which peers it may delegate to. If
its reply contains `DELEGATE <agent>: <task>`, Canvastrator runs that task on the named
agent, draws a transient call edge for the duration, and feeds the answer back.

> This is the POC stand-in for the planned MCP `ask_agent` tool. It's real message
> passing between two live agents, negotiated over the transcript rather than over MCP.
> The MCP server is the intended production mechanism.

## Not built yet

- **MCP nodes** — the design is written up, no implementation.
- **Directory listing on folder nodes** — a folder node shows its path, not its contents.
- **The Canvastrator MCP server** (`list_agents` / `ask_agent` / `read_context`), which
  would replace the `DELEGATE` convention.
- **Skill library on disk** — skills live on the canvas only, not in `~/.canvastrator/skills`.
- **Turn summarization** — a bus entry is currently the turn's text, truncated. Real
  summarization is still an open question (cost vs. fidelity).
- **Transcript virtualization** — fine for a POC, will not hold up at scale.

## Verification

- `cargo test` — 30 tests: provider adapters against real captured CLI output (including
  malformed and unknown lines), permission-flag mapping per mode, and base64 against the
  RFC 4648 vectors.
- `bun run test` — 53 tests: cwd resolution from the graph, file-kind/language routing,
  canvas serialization round-trips including malformed files, and autosave behaviour
  (including a regression test for the empty-overwrite bug).

The end-to-end path was verified against the live `claude` CLI: streaming, resume
across turns, cost accounting, context transfer between two sessions, a full delegation
round-trip, the no-folder guard, cwd actually taking effect (`pwd` returned the wired
folder), a file node auto-spawning wired to the agent that read it, and an agent in the
default `auto` mode both writing a file to disk and running a build command
(`git init && make build`, which `acceptEdits` had refused). The viewer was exercised against
real files: code read/write round trip, truncation flagged, a write to a nonexistent path
refused, and a PNG decoded to a valid data URI. Canvas persistence was exercised live:
an empty canvas wrote nothing, a canvas with nodes autosaved with no manual save, a
rename persisted to disk, and reopening restored the graph with edges intact and session
state reset to idle. The switcher was exercised with two canvases: both listed with node
counts, switching swapped the graph, emptying an open canvas did not damage its file, and
an explicit save still persisted the empty state.

**Codex and opencode adapters are written but unverified end-to-end** — on this machine
`codex` returns 401 (not logged in) and `opencode` has no credits. Their argv and event
shapes come from their real `--help` output and observed error events.
