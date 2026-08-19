import type { Persona } from './library'
import { EFFORTS, type Effort, type Permission, type Provider } from './types'

const PROVIDERS: Provider[] = ['claude', 'codex', 'opencode']
const PERMISSIONS: Permission[] = ['plan', 'auto', 'full']

const rid = () => Math.random().toString(36).slice(2, 10)

/**
 * Personas the orchestrator invented, written as fenced blocks:
 *
 * ```canvastrator-persona
 * name: api-designer
 * provider: claude
 * model: opus
 * effort: high
 * permission: plan
 * description: When to use this
 * ---
 * The brief, over as many lines as it likes.
 * ```
 *
 * A fence rather than a single line because a brief is multi-line by nature,
 * and a fence survives markdown rendering intact.
 */
export function parsePersonaDefinitions(text: string): Persona[] {
  const out: Persona[] = []
  const fence = /```canvastrator-persona\s*\n([\s\S]*?)```/gi

  for (const match of text.matchAll(fence)) {
    const body = match[1]
    // Everything after a lone `---` is the brief; before it, key: value pairs.
    const split = body.search(/^\s*---\s*$/m)
    const head = split === -1 ? body : body.slice(0, split)
    const instructions =
      split === -1 ? '' : body.slice(split).replace(/^\s*---\s*$/m, '').trim()

    const fields: Record<string, string> = {}
    for (const line of head.split('\n')) {
      const kv = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i)
      if (kv) fields[kv[1].toLowerCase()] = kv[2].trim()
    }

    const name = fields.name?.trim()
    // Without a name there's nothing to SPAWN, and without a description the
    // orchestrator can't tell later whether it fits — both are required.
    if (!name || !fields.description) continue

    const provider = PROVIDERS.includes(fields.provider as Provider)
      ? (fields.provider as Provider)
      : 'claude'
    const permission = PERMISSIONS.includes(fields.permission as Permission)
      ? (fields.permission as Permission)
      : 'auto'
    // Unlike provider and permission, an unrecognised effort falls through to
    // undefined rather than to a level we picked — the CLI's default is the
    // honest answer when the orchestrator wrote something we don't know.
    const effort = EFFORTS.includes(fields.effort?.toLowerCase() as Effort)
      ? (fields.effort.toLowerCase() as Effort)
      : undefined

    out.push({
      id: `persona_${rid()}`,
      name,
      description: fields.description,
      provider,
      permission,
      instructions: instructions || fields.instructions || '',
      ...(fields.model ? { model: fields.model } : {}),
      ...(effort ? { effort } : {}),
    })
  }
  return out
}
