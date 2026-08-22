# Canvastrator

Canvastrator is a macOS desktop app that runs a squad of terminal AI coding agents on
an infinite canvas. You place an agent, wire a folder into it to say where it works,
and talk to it. The first agent you place is the **orchestrator**: instead of doing the
work itself, it names the *shape* of the job, spawns specialist agents from a persona
library to do the pieces, and reports back. Every agent is a real `claude` / `codex` /
`opencode` process running in a real directory on your machine, and the canvas is the
picture of what they are doing — who spawned whom, which folder each is in, which files
they touched, what it has cost so far.

The repo directory is named `gridterm` for historical reasons. The product is
Canvastrator everywhere it matters: `package.json` `"name": "canvastrator"`,
`src-tauri/tauri.conf.json` `productName` / window title / bundle id
`com.canvastrator.app`, and the `<canvastrator-*>` prompt vocabulary the agents
actually receive. There is no separate "Canvastrator" service — the app in this repo
*is* Canvastrator.

**Status: working proof of concept.** The core loop is real — sessions spawn actual CLI
processes, stream tokens back, keep their conversation across turns, share context over
edges, spawn and delegate to each other.

```bash
bun install
bun run tauri:dev      # development
bun run tauri build    # macOS .app + .dmg
bun run test           # vitest
bun run lint           # oxlint
cd src-tauri && cargo test
```

The release bundle lands at `src-tauri/target/release/bundle/macos/Canvastrator.app`
(plus a `.dmg` alongside it). It's ad-hoc signed, so it opens from Finder on the machine
that built it without a Gatekeeper prompt.

Double-click empty canvas for the spawn ring → **Agent**. Right-click → **Folder…** to
pick a directory and wire it in. The folder node *is* the session's working directory —
an agent with no folder edge refuses to run rather than defaulting somewhere surprising.

---

## Is it a harness?

**Yes. Canvastrator is a multi-agent orchestration harness for terminal coding-agent
CLIs, wearing a canvas as its interface.**

That is the honest category, and the boundary is unusually sharp because the harness and
the thing it harnesses are separate programs:

**What Canvastrator implements itself** — everything above the model:

- The orchestration model: six named job shapes, the ladder that ranks them by cost, and
  the rule that the cheapest one that fits wins (`src/lib/patterns.ts`).
- The control-line protocol — `PATTERN`, `PLAN`, `SPAWN`, `DELEGATE`, `REPORT` — and the
  parsers that make those lines *do* something rather than merely display
  (`src/lib/patterns.ts`, `src/lib/plan.ts`, `src/lib/patternline.ts`,
  `src/lib/report.ts`, `parseSpawn` in `src/lib/store.ts`).
- Prompt assembly: role briefs, canvas rules, skills, attached files, the cross-agent
  context bus, the persona roster, the peer list — each sent once and again only when it
  changes, with per-agent watermarks (`send` in `src/lib/store.ts`).
- The runtime that enforces the declared shape: fan-out vs. sequence, a step/shape
  consistency check, and the ceilings (`MAX_SPAWN_DEPTH` 2, `MAX_CHILDREN_PER_AGENT` 8,
  `MAX_SESSIONS` 24, `MAX_PLAN_STEPS` 24, `MAX_FANOUT` 4).
- Process supervision: argv construction per provider, streaming JSONL → a
  provider-neutral event vocabulary, interrupt, retry/backoff surfacing, PATH repair for
  GUI launches (`src-tauri/src/providers.rs`, `session.rs`, `env.rs`, `event.rs`).
- The persona library, the canvas graph, persistence, layout, cost and context
  accounting, and the whole UI.

**What it delegates entirely** — everything the model does:

- Inference. Canvastrator never calls an LLM API. It has no API key, no model client, no
  token sampling. Look for one: `src/lib/bridge.ts` is all `invoke()` into Rust, and the
  Rust side's only outbound work is `Command::new(exe)` on a CLI binary.
- Tool use. File reads and writes, shell commands, search — those are the CLI's tools,
  run under the CLI's own sandbox and safety classifier. Canvastrator only *observes*
  them, via the `paths` on each tool-call event, and turns them into nodes.
- Conversation storage. Each turn is a fresh process; the transcript on the provider's
  side is picked back up by session id (`--resume` / `exec resume` / `--session`).
- Authentication and billing. You are logged into `claude` / `codex` / `opencode`
  already; Canvastrator inherits that.

So the boundary is: **Canvastrator decides which agents exist, what each one is told, in
what order they run, and what comes back. The CLI decides what any single agent actually
does.** If you deleted Canvastrator, you would still have three working coding agents.
If you deleted the CLIs, Canvastrator would have nothing to run.

Two honest qualifications:

- It is also a **chat client** and a **file editor** — you can talk to one agent, open a
  file node in Monaco, and edit it (`src/components/FileViewer.tsx`). Those are real
  features, not scaffolding. But they are the interface around the harness, not the
  point of it.
- "Harness" understates one thing: Canvastrator does not just *run* agents, it applies a
  **cost discipline** to them. The single largest body of prompt text in the repo
  (`patternBlock` in `src/lib/patterns.ts`) exists to stop the orchestrator from fanning
  out when one agent would have done. A plain harness runs what it is told; this one
  argues about it first, and enforces the argument in code.

---

## The mental model

Four things, and the relationships between them are the whole app.

**The canvas** is a React Flow surface (`src/Canvas.tsx`). It is the only permanent
surface — one 52px rail, and every panel floats over it and closes on Esc. A canvas is
a saved document; you can have many, and switch between them from the canvas name in the
top bar.

**A node is a noun.** Registered in `src/Canvas.tsx`:

| Node | Is | Component |
| --- | --- | --- |
| `session` | A live agent — a provider, a model, a permission tier, a transcript, a cost | `nodes/SessionNode.tsx` |
| `folder` | A directory. Wired into an agent, it sets that agent's cwd | `nodes/FolderNode.tsx` |
| `file` | A file. Wired *in*, its contents are injected; created automatically when an agent touches one | `nodes/FileNode.tsx` |
| `skill` | Free-text instructions injected into whatever it is wired to | `nodes/SkillNode.tsx` |
| `mcp` / `mcptool` | An MCP server attached to a session, and its tools | `nodes/McpNode.tsx` |
| `shape` / `planstep` | The orchestrator's declared job shape, and the steps it produced | `nodes/ShapeNode.tsx`, `nodes/PlanStepNode.tsx` |
| `changes` | Every file the agents wrote, diffed against git HEAD, revertable a hunk at a time | `nodes/ChangesNode.tsx` |
| `terminal` | A real shell on the canvas | `nodes/TerminalNode.tsx` |

**An edge is a verb** (`src/components/edges.tsx`), and the graph is the permission
boundary throughout — an agent can reach exactly what is wired to it:

| Edge | Means |
| --- | --- |
| `cwd` | This folder is that agent's working directory |
| `attach` | This folder is an extra readable root, not the cwd |
| `file` | Inject this file's contents into that agent's next turn |
| `context` | Source agent's turn summaries flow into the target's next prompt |
| `spawn` | Source agent created the target — lineage, and how spawn depth is measured |
| `call` | A live agent→agent delegation, transient, drawn only while it runs |
| `mcpuse` | This MCP server is available to that agent |
| `plan` | This step belongs to that shape card |

**An agent** is a session node plus a provider-side conversation. The first session on a
canvas gets `role: 'orchestrator'`; every one after it is a `worker` (`addSession` in
`src/lib/store.ts`). That single field decides which briefs it receives — the
orchestrator gets the pattern ladder, the persona roster, and the spawn protocol; a
worker gets the REPORT protocol instead.

**A persona** is a reusable agent archetype — name, description, provider, model,
effort, permission tier, and an opening brief (`src/lib/library.ts`). Personas are not
nodes. They live in a library on disk, available on every canvas, and spawning one
creates a session node from it.

---

## How a turn actually flows

Take a message typed into the chatbox pointed at the orchestrator
(`src/components/CentralChat.tsx`, composer in `src/components/Composer.tsx`, bubbles
and menus shared with `src/components/ChatPanel.tsx`). It calls `send(nodeId, text)` in
`src/lib/store.ts`, which is the spine of the app.

1. **Guard.** If the agent is `thinking` or `streaming`, the message is queued and sent
   when the turn ends rather than rejected.
2. **Resolve the working directory** from the graph, not from a setting —
   `resolveCwd(nodes, edges, nodeId)` follows the `cwd` edge. No folder, or a folder
   that has moved, and the turn is refused with a message on the node.
3. **Assemble the prompt** out of blocks, each with its own watermark so it is sent once
   and again only when it changes: canvas rules, the standing block (which explains that
   blocks are not repeated), the agent's own brief, the folder set, attached file
   contents, the map of files other agents have opened, skills, fresh context-bus
   entries from inbound `context` edges, the persona roster, the peer list, and — for an
   orchestrator — `orchestratorBlock()`, which contains the pattern ladder. The user's
   text goes last.
4. **Optimistic UI.** A user message and a pending assistant message land in the
   transcript, the node goes `thinking`, context edges light up, a Pulse entry is
   logged.
5. **Cross the bridge.** `sendTurn()` in `src/lib/bridge.ts` is `invoke('send_turn')`
   into Rust.
6. **Spawn a process.** `run_turn` in `src-tauri/src/session.rs` builds argv via
   `Provider::args()` in `src-tauri/src/providers.rs`, resolves the binary by *absolute
   path* (`env::which` — a Finder-launched app has no `~/.local/bin` on its PATH), and
   spawns it in the resolved cwd with the user's real PATH.
7. **Stream back.** The CLI's JSONL stdout is parsed into a provider-neutral `AgentEvent`
   (`src-tauri/src/event.rs`) and emitted on the `session://event` channel. The frontend
   applies each one in `applyEvent` — text deltas, tool calls, retries, usage, exit.
8. **Land the turn.** When the process exits, Canvastrator reads the reply as a
   *protocol*, not just as text:
   - `parsePattern` pulls the `PATTERN` line → a shape card on the canvas.
   - `parsePlan` / `parseSpawn` pull the steps → plan step nodes, or an immediate spawn.
   - `parsePersonaDefinitions` pulls any fenced persona definition → saved to the library.
   - `parseReport` pulls a worker's `REPORT:` block → and *only that block* is handed
     back to the parent, so the orchestrator pays for the result rather than for the
     worker's whole reasoning.
   - A `ContextEntry` is appended to the canvas-wide bus for anything downstream.
9. **Recurse.** A spawn creates a real child session node, wires it (`spawn` edge for
   lineage, `context` edges both ways, the parent's folders), sets it running, and feeds
   its report back into the parent's conversation — which is another turn, at step 1.

Each turn is a **fresh process**. Continuity comes from the provider's own session id
being passed back on the next turn, which is simpler and more robust than holding a
long-lived interactive process, at the cost of per-turn startup.

---

## The six orchestration patterns

`src/lib/patterns.ts`. Before the orchestrator writes any steps, it must open its reply
by naming the shape of the job. The six are a **ladder, not a menu** — rung 1 is one
agent in a loop with its tools, and each rung down buys a capability and pays for it in
tokens and coordination.

| # | `id` | Name | Costs | Steps | Use when | Not when |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `single` | single-agent loop | baseline | exactly 1 | the job fits one context and one agent has the tools to finish it | subtasks are genuinely independent and would gain from concurrency |
| 2 | `chain` | prompt chaining | one agent per step | 2+ | the steps are known now and each works on the last one's output | the steps aren't knowable until something has run |
| 3 | `route` | routing | a classification, then one specialist | exactly 1 | the request falls into distinct kinds different specialists handle better | every request would be handled the same way anyway |
| 4 | `parallel` | parallelisation | × the width of the fan-out | 2+ | subtasks are known, don't read each other's output, and are worth running at once | the steps depend on each other or need one shared evolving context |
| 5 | `orchestrate` | orchestrator-worker | × workers, unknown until it runs | 1+ | what the subtasks even *are* can't be settled until some work is done | the subtasks are predictable — a chain or fan-out does it for less |
| 6 | `evaluate` | evaluator-optimizer | one agent per revision cycle | 2+ | there's a stated bar and the work measurably improves under critique | the first attempt clears the bar, or nobody can say what "good" is |

Three things make this more than a label:

- **The declaration is executed.** `parallel` is the only shape whose steps don't read
  each other, so approving a `parallel` plan starts every pending step at once (in waves
  of `MAX_FANOUT` = 4) and feeds all their reports back in **one** orchestrator turn.
  Every other shape runs one step at a time, in order — which is also what an
  undeclared plan does, because in-order is the reading that can't be expensive by
  mistake.
- **The declaration can be wrong.** `checkShape(id, count)` compares the shape against
  the number of steps actually written. "single with four steps" and "chain with one"
  are contradictions; the plan runs in order regardless of its label, with the complaint
  shown.
- **Synonyms are accepted.** The models have read the same literature the ladder came
  from, so `parallelization`, `fan-out`, `orchestrator-worker`, `prompt-chaining` and
  friends all map to the six ids (`ALIASES` / `toPatternId`). Losing a correct decision
  over a spelling would be the least defensible way to lose one.

The prompt itself (`patternBlock`) is blunt about the failure mode it exists to prevent:
*"ONE AGENT IS THE DEFAULT. Every agent past the first has to earn its place."* No
unasked-for reviewers, no splitting one coherent job to look thorough, no fanning out to
cover the angles on a question with one answer.

---

## The control-line protocol

Five line-anchored directives carry everything between Canvastrator and the models. They
are line-anchored on purpose: a sentence containing the word "SPAWN" is prose about the
protocol, not an instruction to start an agent.

| Line | Written by | Does |
| --- | --- | --- |
| `PATTERN <id>: <why>` | orchestrator, first line | Declares the job shape and the reason. First one wins. |
| `SPAWN <persona>: <task>` | orchestrator | Creates a real child agent and runs the task. Task runs to the next directive or the end of the reply. |
| `PLAN <persona>: <task>` | orchestrator, planning mode | Proposes a step. One line each. Nothing runs until approved. |
| `DELEGATE <agent>: <task>` | orchestrator | Runs a task on an existing peer agent, draws a `call` edge, feeds the answer back. |
| `REPORT: <result>` | any worker, last block | The only part of a worker's reply that travels back to its parent. |
| ` ```canvastrator-persona ` | orchestrator | Defines a new role, saved to the library. |

A real orchestrator reply — this one produced the panels work on this branch:

```
PATTERN single: one specialist can read the node/panel code and make the change
end-to-end in a single context; a design step or a reviewer isn't needed for a
change this well-specified, and nothing here splits into independent subtasks.

SPAWN implementer: In the repo at /Users/you/Github/gridterm (branch
`horizontal-flow`), convert the Pulse, Library, and Usage features from React
Flow canvas nodes into floating screen-space panels. Current state to orient
yourself with first: `src/Canvas.tsx` registers the custom node types …
```

Canvastrator reads that reply three ways at once. `parsePattern` lifts the first line
into a shape card. `parseSpawn` creates the child, wires it, and sends it the task
verbatim. `splitAgentText` (`src/lib/patternline.ts`) splits the same text for
*rendering*, so the pattern shows as a badge and the spawn as a card rather than as raw
paragraphs — and it deliberately mirrors the store's parsers rather than being a second,
prettier reading of the same text, because a card that shows something other than what
actually ran is worse than no card.

When nothing in the roster fits, the orchestrator is told to **invent a persona rather
than force a bad fit or quietly do the job itself**:

````
```canvastrator-persona
name: copywriter
provider: claude
model: sonnet
effort: medium
permission: plan
description: Writes short-form original text — poems, taglines, release notes.
---
You write short original copy. Return the piece and nothing else.
```
SPAWN copywriter: Write a haiku about grids
````

It is guided on each field, including the model (heavy tier for hard reasoning and
architecture, mid for ordinary implementation and review, light for cheap mechanical
passes) and the permission tier (`plan` for read-only roles, `auto` when it must edit or
run things). An invented persona never overwrites an existing name.

**Planning mode** (`G` for canvas rules, planning toggled in the UI) swaps `SPAWN` for
`PLAN`: the orchestrator proposes the whole job as a list, nothing runs until you
approve, and you can edit a task, drop a step, or approve them one at a time.

`src/lib/decisions.ts` reads all of this back out of the transcript as a **decision
path** — what you asked, what shape it declared and why, what it proposed, what the app
refused, what it answered directly. Derived, never stored, so it cannot claim a decision
the conversation does not contain.

---

## Personas and the library

A persona (`src/lib/library.ts`) is: `name`, `description`, `provider`, optional
`model`, optional `effort`, `permission`, `instructions`.

- **`name` is the address.** `SPAWN reviewer:` resolves by name, so the library holds one
  persona per name — a duplicate would make spawning silently ambiguous.
- **`description` is load-bearing.** It is the only thing the orchestrator reads when
  deciding what fits a task. A vague description makes routing vague.
- **`instructions`** become the child's standing brief, stored on the node so it survives
  and stays editable rather than being a one-shot message at the top of a transcript.

Defining a persona does not create anything on the canvas. It adds an entry the
orchestrator may instantiate — and instantiating it is what makes a node. `spawnChild`
(`src/lib/store.ts`) creates the session, gives it the persona's provider/model/effort/
permission/brief, places it to the right of its parent, and wires it: a `spawn` edge for
lineage, `context` edges both ways, and every folder edge the parent had, primacy
preserved.

The library is **available without wiring** — re-attaching "reviewer" on every new
canvas would defeat the point of having a library. The canvas is still the record of
what happened, because spawning drops the node onto it. First run seeds four ordinary,
editable, deletable starters: `reviewer`, `implementer`, `investigator`, `researcher`.

Personas used to also be canvas nodes. They aren't any more: the `personality` node type
is gone from the graph, and `strandedPersonas` in `src/lib/persist.ts` migrates any left
in an old canvas file into the library on load.

Guards on spawning, all in `src/lib/store.ts` and all enforced by the app rather than by
the prompt: spawn depth ≤ 2 (measured by walking `spawn` edges up the graph, not by a
counter that could drift), 8 children per agent, 24 sessions per canvas, 24 steps per
plan, and 2 consecutive delegations before a forced pause. Every refusal is written onto
the node — a bare `return` would leave the canvas claiming to have started an agent that
does not exist.

---

## Persistence: what is saved where

Everything lives under the platform app-data dir,
`~/Library/Application Support/com.canvastrator.app/`.

| What | Where | Shape |
| --- | --- | --- |
| Canvases | `canvases/<id>.json` | One JSON file per canvas (`src-tauri/src/canvas.rs`, `src/lib/persist.ts`) |
| Persona library | `personalities.json` | The file the app reads (`src-tauri/src/library.rs`) |
| Personas, readable | `personas/<slug>.md` | Mirror of the library, one markdown file each — greppable, diffable, dotfiles-able |
| Logs | `~/Library/Logs/com.canvastrator.app/canvastrator.log` | Full argv, cwd, permission tier, exit status, stderr — enabled in release builds too |

A canvas file is an envelope the Rust side can read without the UI opening it (`id`,
`name`, `updatedAt`, `version`, so the switcher can list canvases with node counts),
wrapping a `data` blob the frontend owns entirely: nodes with their geometry and data
(including transcripts and each session's provider session id, so conversations resume
after a restart), edges, the context bus, delivery watermarks, canvas rules, panel
state, notifications, and any live plan.

Written temp-then-rename, so an interrupted save can't leave a half-written file. Ids are
validated before becoming filenames, so nothing can escape the directory.

Deliberately **not** saved:

- React Flow's `selected` / `dragging` / `measured`, so a canvas can't restore mid-drag.
- Transient `call` edges and edge animation timestamps.
- Edges whose endpoints are gone.
- `thinking` / `streaming` session state — the process died with the app, so a restored
  session would spin forever. `error` is a real outcome and survives.

Autosave is debounced 1.2s and starts from the first node rather than waiting for a
manual save — but **never writes an empty graph over a saved canvas**, because reaching
zero nodes is far more often a mis-click than an edit worth persisting, and the file is
the only copy. Loading is forgiving: a file that lost a node opens with what's left.

---

## The tech stack

```
React 19 + TypeScript (canvas, chat, zustand)
   │  invoke()          ▲ session://event
   ▼                    │
Tauri 2 commands (Rust) ┴─ SessionRegistry
   │
   ▼
claude / codex / opencode  ← one process per turn, JSONL on stdout
```

**Runtime: Tauri 2 desktop, macOS.** Not a web app. `bun run dev` serves the frontend on
Vite, but `src/lib/bridge.ts` calls `invoke()` unconditionally for every provider
detection, turn, file read, and canvas save — none of which exists in a browser. There
is no HTTP backend and no server-side anything. `bun run tauri:dev` is how you run it.
The bundle config targets macOS specifically (ad-hoc signing, `Entitlements.plist`,
`underWindowBackground` window effects, `macOSPrivateApi`); iOS and Android icons are
present but nothing else is.

Frontend: React 19, TypeScript, Zustand, `@xyflow/react` (React Flow) for the canvas,
`@dagrejs/dagre` for layout, Tailwind 4, Radix primitives, Monaco (self-hosted, not
CDN-loaded — a desktop app shouldn't need the network to open a file), `@xterm/xterm`
for terminal nodes, Vite 8, Vitest, oxlint.

Backend: Rust, Tauri 2, Tokio for process supervision.

### The provider adapters

The key finding from the original spike: all three CLIs expose structured JSONL streaming
*and* session resume, so Canvastrator needs **no PTY and no ANSI parsing**.

| CLI | Streaming | Resume |
| --- | --- | --- |
| `claude` | `--print --output-format stream-json --include-partial-messages` | `--session-id` / `--resume` |
| `codex` | `exec --json` | `exec resume <thread>` |
| `opencode` | `run --format json` | `run --session <id>` |

Permission tiers map per provider (`src-tauri/src/providers.rs`):

| Canvastrator | claude | codex | opencode |
| --- | --- | --- | --- |
| `plan` (read-only) | `--permission-mode plan` | `--sandbox read-only` | *(no `--auto`)* |
| `auto` *(default)* | `--permission-mode auto` | `--full-auto` | `--auto` |
| `full` | `--permission-mode bypassPermissions` | `--dangerously-bypass-approvals-and-sandbox` | `--auto` |

`auto` and not `acceptEdits`: `acceptEdits` auto-approves file writes and a handful of
filesystem commands only, so `cargo build` or `bun install` is denied outright — and in a
`--print` run there is no prompt to approve, so the agent reports "every build command
was auto-denied" and looks broken. `auto` defers to the provider's own safety
classifier. `full` is opt-in, rendered in the danger colour, and **not verified
end-to-end** — use `auto`.

### The bundled app and PATH

A GUI app launched from Finder gets `/usr/bin:/bin:/usr/sbin:/sbin` from launchd, not
your shell PATH. That breaks Canvastrator twice: `claude` lives in `~/.local/bin` and
isn't found, and any agent that does spawn can't run `cargo`, `bun`, or `git` either. So
on startup Canvastrator asks the login shell what PATH it would give (`$SHELL -lic`),
unions it with the inherited PATH and the usual install dirs, and uses that for both
provider detection and every spawned child (`src-tauri/src/env.rs`). Providers are
spawned by absolute path, never by bare name.

---

## Reading the canvas

**Density.** An agent node shows three amounts of truth, and zoom picks between the
first two (`src/lib/density.ts`): below 50% `glance` — name, one live verb, elapsed,
context hairline; at or above 50% `summary` — plus the last turn in the agent's own
words, its tools, its cost; double-click for `full` — plus the transcript. `full` is
never reached by zooming, and a node you opened stays open.

The **live verb** is derived from tool calls, not from the reply (`src/lib/liveverb.ts`),
because tool calls are the only account of the work that arrives *while* it is happening:
`editing store.ts`, `running bun`, `retry 3/10`. A failure or a question outranks any of
them. The **summary** is the agent's own sentence, shown verbatim — no second model
paraphrases it, so there is nothing there to be wrong about.

**Layout is the plan** (`src/lib/layout.ts`). The canvas reads left to right: supports in
on the left, the agent, what it produced on the right. When a plan is in flight its shape
ranks the agents — a `parallel` plan lays out in one column beside the orchestrator, an
in-order plan chains left to right, each a rank past the one it waited for. The rule is
how the plan *actually runs*, not what it was labelled: a four-step "parallel" the app
demoted lays out as the sequence it is. Mechanically these are extra edges handed to
dagre before it ranks, so ordering and crossing-minimisation stay dagre's job.

**Files map themselves.** Tool calls carry structured `paths`, so any file an agent reads
or writes materialises as a node wired back to it — green edge for a write, dashed grey
for a read, capped at 10 per session. Only real path arguments count; a `Bash` command
string never becomes a file node.

**Motion encodes state.** Breathing border = thinking, travelling dashes = context
moving, fast pulse = a live agent→agent call. Honors `prefers-reduced-motion`.

### Panels and keys

Pulse, Usage and Personas float over the canvas (`src/components/panels/`). **Usage** is
total spend, burn rate per ten minutes, each agent's share, and how full every context
window is. **Pulse** (`src/lib/pulse.ts`) is one line per thing that happened across
every agent — prompts, shapes chosen, turns landed, questions asked, files written —
with the notification bell as a filtered view over it; clicking an entry flies the
viewport to the node.

| Key | Does |
| --- | --- |
| `⌘K` | Spawn a persona, run a canvas-wide action, or jump to any node by name |
| `S` `F` `D` `K` `E` | New agent · folder · file · skill · terminal, under the cursor |
| `P` `U` `L` | Toggle Pulse, Usage, personas |
| `G` | Canvas rules |
| `T` / `⇧⌘L` | Tidy |
| `⌥1` `⌥2` `⌥3` | Pin the selection — or every agent — to glance, summary, full |
| `⇧⏎` | Step back to the whole canvas |
| `⌘B` / `⌘\` | Toggle the rail drawer |

`⌥`-digit is read off the physical key, not what was typed (`⌥1` on a Mac keyboard
produces `¡`), and is a held chord rather than a bare digit because it overrides the
zoom.

---

## Using Canvastrator to build Canvastrator

It works, with one caveat: **the running app is a copy.** Agents edit the repo, but the
app you're using was built from an earlier state.

1. Point a folder node at the repo and let agents work normally.
2. To pick up their changes, quit Canvastrator, `bun run tauri build`, replace the
   installed app, relaunch — you can't overwrite a running bundle.
3. Don't run `bun run tauri:dev` and the installed app at once. Both autosave to the same
   `canvases/` directory and the last write wins.

## Not built yet

- **The Canvastrator MCP server** (`list_agents` / `ask_agent` / `read_context`), which
  would replace the `SPAWN` / `DELEGATE` transcript conventions with real tool calls.
  Those conventions are explicitly the POC stand-in for it.
- **Directory listing on folder nodes** — a folder node shows its path, not its contents.
- **Skill library on disk** — skills live on the canvas only.
- **Turn summarization** — a bus entry is the turn's text, truncated. Real summarization
  is still an open question (cost vs. fidelity).
- **Transcript virtualization** — fine for a POC, will not hold up at scale.
- **Codex and opencode end-to-end verification.** Both adapters are written and unit
  tested against captured CLI output, but the live path has only been exercised against
  `claude`.
