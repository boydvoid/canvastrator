/**
 * What a worker hands back to whoever asked for the work.
 *
 * A spawned agent's reply is written for the user: it reasons out loud, quotes
 * files, and shows its working. Splicing all of that into the orchestrator's
 * context — which is what used to happen — pays for the same reading twice and
 * buries the one thing the orchestrator actually needs, which is what came of
 * the task. So the worker is asked to end with a REPORT block, and only that
 * block travels. The rest stays on the worker's own node, where the user can
 * still read it in full.
 */

/**
 * Cap on a hand-back when the worker wrote no REPORT block.
 *
 * The protocol is an instruction, and instructions get forgotten — so there
 * has to be a fallback, and it has to be bounded or forgetting the protocol
 * would cost more than never having had one.
 */
export const REPORT_FALLBACK_CHARS = 3500

/** Told to every worker on its opening turn. */
export const REPORT_INSTRUCTION = [
  '<canvastrator-report>',
  'End your reply with a report block:',
  '',
  'REPORT: <what you found or changed, and what the agent that asked for this needs to carry on>',
  '',
  'Only the REPORT block is passed back to whoever asked for this work. Everything above it stays on your node for the user to read, so the report has to stand on its own: name the files you touched, the decisions you made, and anything still open or unresolved.',
  '',
  'Keep it under ten lines. Do not restate the task, and do not pad it with what you were about to do — it is a result, not a status update.',
  '</canvastrator-report>',
].join('\n')

/**
 * The REPORT block in a reply, or null if it wrote none.
 *
 * The last one wins and runs to the end of the reply: a worker that thinks
 * out loud may well write the word REPORT while describing what it is about
 * to do, and the block it was asked for is the one it finished with.
 */
export function parseReport(text: string): string | null {
  const opener = /^[ \t]*REPORT[ \t]*:/gim
  let last = -1
  for (const m of text.matchAll(opener)) last = m.index + m[0].length
  if (last < 0) return null
  const body = text.slice(last).trim()
  return body || null
}

export type HandBack = {
  /** What to send on. */
  body: string
  /** Set when the worker wrote a REPORT block and this is it. */
  summarised: boolean
  /** Set when there was no block and the raw reply had to be cut short. */
  truncated: boolean
}

/**
 * Reduce a worker's reply to what its caller is given.
 *
 * Truncation keeps the head rather than the tail. A reply that runs long is
 * usually long at the front — the reading and the reasoning — and ends on its
 * conclusion, which argues for the tail. But a cut tail reads as a complete
 * answer that simply stops, and the caller cannot tell it was cut; a cut head
 * announces itself. The marker says which end went, so neither is silent.
 */
export function handBack(answer: string): HandBack {
  const report = parseReport(answer)
  if (report) return { body: report, summarised: true, truncated: false }

  const trimmed = answer.trim()
  if (trimmed.length <= REPORT_FALLBACK_CHARS) {
    return { body: trimmed, summarised: false, truncated: false }
  }
  return {
    body: trimmed.slice(0, REPORT_FALLBACK_CHARS),
    summarised: false,
    truncated: true,
  }
}

/**
 * The hand-back as the caller receives it.
 *
 * Tagged rather than run in as prose so the caller can tell a colleague's
 * result from the user's own instructions, and told plainly where the rest
 * went — otherwise a truncated reply reads as a worker that trailed off.
 */
export function reportBlock(name: string, role: string, hand: HandBack): string {
  const who = name === role ? name : `${name} (a ${role})`
  const tail = hand.truncated
    ? `\n\n[cut short — ${who} wrote no REPORT block, and the rest of the reply is on its node]`
    : ''
  return [
    `<canvastrator-report from="${name}"${hand.summarised ? '' : ' verbatim="true"'}>`,
    `${who} reported:`,
    '',
    hand.body + tail,
    '</canvastrator-report>',
  ].join('\n')
}
