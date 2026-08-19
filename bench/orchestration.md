# The orchestration bench

A fixed set of prompts for measuring one thing: **does the orchestrator reach for
the cheapest shape that actually fits?**

The failure this exists to catch is not a wrong answer. It is a right answer that
cost four agents when one would have done — which looks like thoroughness in the
transcript and like money on the bill. Half of these prompts are bait for exactly
that.

## Running it

1. Fresh canvas. Folder node on this repo, one orchestrator, planning mode **on**.
2. Paste one prompt. Read the reply, **do not approve the plan** — the shape and
   the step count are the measurement, and approving costs real tokens.
3. Record: the declared shape, the number of steps, and whether Canvastrator
   warned that the two disagree.
4. Discard the plan and clear the canvas between cases. A canvas that already has
   five agents on it is a different question than a canvas that has none.

Approve a case only when you want the second measurement — wall-clock and the
canvas cost total — and then approve the *same* case in both directions to have
anything to compare.

## Scoring

Per case, in order of how much each is worth:

- **Shape** — did it declare the expected one? A neighbouring rung with a stated
  reason is a pass; two rungs down is not.
- **Width** — steps within the expected count. Over is the failure that matters;
  a plan of six where two would do is the whole reason for this file.
- **Honesty** — no `warning` in the plan panel. A shape that disagrees with its
  own plan is demoted to sequential by the app, so a run that trips it has
  already lost the thing it was reaching for.
- **Restraint** — cases 9 and 10 should produce *no plan at all*. A step written
  for either of them is a straight fail, not a near miss.

## The cases

| # | prompt | shape | steps | what it baits |
|---|--------|-------|-------|---------------|
| 1 | `What does src/lib/patterns.ts do?` | single | 1 | one file, one reader — an easy place to invent a second opinion |
| 2 | `Read the README persistence section and src/lib/persist.ts, and tell me whether they still agree.` | single | 1 | two files reads as two agents; it is one comparison |
| 3 | `Find every place a session's working directory is resolved, then change it to fall back to the folder node nearest on the canvas.` | chain | 2 | the change cannot be written before the search has run |
| 4 | `Review these four files independently for unsafe casts: src/lib/store.ts, src/lib/layout.ts, src/lib/persist.ts, src/lib/canvas.ts` | parallel | 4 | the one case where fanning out is right — failing to is also a failure |
| 5 | `Add a keyboard shortcut that toggles planning mode, matching how the other shortcuts are registered.` | single | 1 | ordinary implementation work, which invites an implementer plus a reviewer |
| 6 | `Image paste is broken on resumed codex turns. Work out what is wrong and fix it.` | orchestrate | 1 | genuinely unknown decomposition — the one honest reason to escalate |
| 7 | `Draft release notes for this branch, under 200 words, every line naming a user-visible change. Keep tightening until they meet that.` | evaluate | 2 | a stated bar and a critic, which is what this rung is for |
| 8 | `Is spawn depth counted per agent or per canvas?` | single | 1 | a question with one answer, baiting a fan-out to cover the angles |
| 9 | `What did the last step you proposed actually ask for?` | none | 0 | answerable from the conversation — any step here is a fail |
| 10 | `Which of the six shapes would you use if I asked you to rename a variable?` | none | 0 | a question about the work, not the work |

Cases 9 and 10 have no expected shape because the correct reply contains no
`PATTERN` line and no steps at all.

## What a regression looks like

The bench is worth re-running after any edit to `patternBlock()` in
`src/lib/patterns.ts`, since that text is the whole intervention. Two shapes of
regression to watch for, both of which read as improvements at a glance:

- **Drift upward** — cases 1, 2, 5 and 8 start declaring `chain` and adding a
  reviewer. The prompt has stopped saying that one agent is the default loudly
  enough.
- **Drift downward** — case 4 stops declaring `parallel` and case 6 stops
  declaring `orchestrate`. Restraint that also refuses the cases where fanning
  out is correct is not restraint, it is a slower single-agent loop.
