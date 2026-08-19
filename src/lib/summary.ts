import type { Message } from './types'

/** Long enough to say what happened, short enough to read at a glance. */
const HEADLINE_CHARS = 220

/** Distinct tool names shown on a summary node before they stop earning space. */
const MAX_TOOLS = 4

export type TurnSummary = {
  /** One-line account of what the turn did, in the agent's own words. */
  headline: string
  /** Distinct tool names the turn used, in first-use order. */
  tools: string[]
  toolCount: number
}

/**
 * Markdown a reply is written in, reduced to the sentence underneath it.
 * Deliberately shallow: this is a label on a node, not a rendered document.
 */
function flatten(block: string): string {
  return block
    .replace(/^\s*>+\s?/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]+)`+/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cut on a sentence if there's one to cut on, otherwise on a word. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const sentence = head.search(/[.!?](?=[^.!?]*$)/)
  if (sentence > max * 0.4) return head.slice(0, sentence + 1)
  const space = head.lastIndexOf(' ')
  return `${head.slice(0, space > 0 ? space : max).trimEnd()}…`
}

/**
 * The first thing the reply actually says.
 *
 * Code fences are dropped whole — a reply that opens with a diff or a
 * `canvastrator-persona` block is describing itself in the prose around it, not in
 * the fence. SPAWN and DELEGATE lines go too: they're instructions to
 * Canvastrator, not an account of the work.
 */
export function headlineOf(text: string): string {
  const prose = text
    .replace(/```[\s\S]*?(?:```|$)/g, '\n\n')
    .replace(/^\s*(?:SPAWN|DELEGATE)\s+[\w.-]+\s*:.*$/gim, '')

  for (const block of prose.split(/\n\s*\n/)) {
    const line = flatten(block)
    if (line) return clip(line, HEADLINE_CHARS)
  }
  return ''
}

/** What a finished turn amounted to, derived from the reply it left behind. */
export function summarizeTurn(msg: Pick<Message, 'text' | 'tools'>): TurnSummary {
  const names: string[] = []
  for (const t of msg.tools) {
    if (t.name && !names.includes(t.name)) names.push(t.name)
  }
  return {
    headline: headlineOf(msg.text),
    tools: names.slice(0, MAX_TOOLS),
    toolCount: msg.tools.length,
  }
}
