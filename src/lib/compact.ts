/**
 * Trading a full context window for a note you can read.
 *
 * A long task dies the same way every time: the window fills, the next turn is
 * refused, and everything the agent worked out along the way — the approach it
 * settled on, the two dead ends, the file it must not touch — dies with the
 * conversation. Compaction is the standard answer: summarize the history,
 * start a fresh window seeded with the summary.
 *
 * What is unusual here is where the summary goes. Elsewhere it is an invisible
 * truncation you have to trust; here it is written to a file and put on the
 * canvas as a node, wired to the agent it came from. That makes it three
 * things at once: the seed of the next window, a record you can read when the
 * answer comes back wrong, and something you can wire into a *different* agent
 * — which is how a squad stops rediscovering what one of them already knows.
 */

/** Where the meter stops being a readout and starts being a decision. */
export const COMPACT_AT = 0.8

/**
 * What the agent is asked to write before its window is recycled.
 *
 * Recall first, precision second — the guidance every compaction write-up
 * lands on. The headings are fixed so the note is scannable by a human at a
 * glance and parseable by the next agent that reads it, and they name the
 * things that actually get lost: decisions and their reasons, what is still
 * broken, and what was about to happen next.
 */
export const COMPACT_PROMPT = [
  'Your context window is nearly full and is about to be recycled. Write a handover note for the version of you that continues this work in a fresh window with none of this history.',
  '',
  'Use exactly these headings, and write nothing outside them:',
  '',
  '## Goal',
  'What you were asked to do, in one or two sentences.',
  '',
  '## Decisions',
  'Every choice you made that the next turn must not silently reverse, each with the reason you made it.',
  '',
  '## State',
  'What is done, what is half-done, and which files you changed.',
  '',
  '## Traps',
  'Dead ends, failing tests, and anything you learned the hard way.',
  '',
  '## Next',
  'The next concrete step.',
  '',
  'Be specific: name files, symbols and commands rather than describing them. Leave out anything the next turn can read off disk for itself.',
].join('\n')

/** The note as it is handed to the fresh window. */
export function carryBlock(summary: string): string {
  const body = summary.trim()
  if (!body) return ''
  return [
    '<canvastrator-handover>',
    'This is your own handover note from the previous context window. Treat its decisions as already made.',
    '',
    body,
    '</canvastrator-handover>',
  ].join('\n')
}

/**
 * A filename that sorts by time and says whose note it is.
 *
 * Timestamp first because a directory of these is read newest-last, and an
 * agent can compact more than once in a run — the name has to stay unique
 * without a counter nobody can interpret.
 */
export function noteName(agent: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const slug =
    agent
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'agent'
  return `${stamp}_${slug}.md`
}

/**
 * The note as it is written to disk.
 *
 * A header, because the file outlives the canvas that made it: opened months
 * later in an editor, it has to say who wrote it, when, and about what.
 */
export function noteFile(agent: string, at: number, cwd: string, summary: string): string {
  return [
    `# Handover — ${agent}`,
    '',
    `Written ${new Date(at).toISOString()} when the context window filled.`,
    `Working directory: ${cwd}`,
    '',
    summary.trim(),
    '',
  ].join('\n')
}

/**
 * Whether a window is full enough that compacting is the next move.
 *
 * Null fractions — an unknown model, an agent that has not run — are not
 * offers. A prompt to compact a conversation whose size nobody knows is a
 * guess dressed as advice.
 */
export function shouldOffer(fraction: number | null | undefined): boolean {
  return fraction != null && fraction >= COMPACT_AT
}
