import { invoke } from '@tauri-apps/api/core'
import type { Effort, Permission, PersonalityNodeData, Provider } from './types'

export const LIBRARY_VERSION = 1

/** A persona as it lives in the library — no canvas position, no node id. */
export type Persona = {
  id: string
  name: string
  description: string
  provider: Provider
  model?: string
  effort?: Effort
  permission: Permission
  instructions: string
}

type LibraryFile = { version: number; personalities: Persona[] }

const rid = () => Math.random().toString(36).slice(2, 10)

/**
 * Shipped on first run so the library isn't an empty box. They're ordinary
 * entries — editable and deletable like any other.
 */
export const STARTER_PERSONAS: Persona[] = [
  {
    id: 'persona_reviewer',
    name: 'reviewer',
    description:
      'Reviews a diff or a file for correctness bugs and risky changes. Use before shipping, or when asked to check work.',
    provider: 'claude',
    permission: 'plan',
    instructions:
      'You review code. Read what you are pointed at and report only defects that would actually bite: wrong behaviour, unhandled errors, data loss, races. For each, give the file, the line, and the failing case. Say plainly when you find nothing. Do not edit files.',
  },
  {
    id: 'persona_implementer',
    name: 'implementer',
    description:
      'Writes and edits code to complete a well-specified task. Use when the change is clear and needs doing.',
    provider: 'claude',
    permission: 'auto',
    instructions:
      'You implement the task you are given, and nothing beyond it. Match the surrounding style. Run the project\'s build and tests before reporting. Report what you changed, what you verified, and anything you deliberately left out.',
  },
  {
    id: 'persona_investigator',
    name: 'investigator',
    description:
      'Traces a bug to its cause and reports the mechanism. Use when something is broken and the reason is unknown.',
    provider: 'claude',
    permission: 'auto',
    instructions:
      'You find root causes. Reproduce the problem first, then narrow it until you can name the exact mechanism. Report the cause and the evidence for it. Do not fix anything unless you are asked to — the diagnosis is the deliverable.',
  },
  {
    id: 'persona_researcher',
    name: 'researcher',
    description:
      'Reads a codebase or docs and answers questions about how something works. Use for orientation before changing anything.',
    provider: 'claude',
    permission: 'plan',
    instructions:
      'You answer questions about how things work by reading the source. Cite file paths and line numbers. Distinguish what you verified from what you inferred. Do not edit anything.',
  },
]

export const loadLibrary = async (): Promise<Persona[]> => {
  const file = await invoke<LibraryFile>('load_library')
  return file.personalities ?? []
}

export const saveLibrary = (personalities: Persona[]) =>
  invoke<void>('save_library', { library: { version: LIBRARY_VERSION, personalities } })

export const libraryLocation = () => invoke<string>('library_location')

/** Where the per-persona markdown files are written. */
export const personasLocation = () => invoke<string>('personas_location')

/** A canvas node's data, as a library entry. */
export const personaFromNode = (d: PersonalityNodeData): Persona => ({
  id: `persona_${rid()}`,
  name: d.name,
  description: d.description,
  provider: d.provider,
  permission: d.permission,
  instructions: d.instructions,
  ...(d.model ? { model: d.model } : {}),
  ...(d.effort ? { effort: d.effort } : {}),
})

/** A library entry, as node data. */
export const nodeDataFromPersona = (p: Persona): Omit<PersonalityNodeData, 'personalityId'> => ({
  name: p.name,
  description: p.description,
  provider: p.provider,
  permission: p.permission,
  instructions: p.instructions,
  ...(p.model ? { model: p.model } : {}),
  ...(p.effort ? { effort: p.effort } : {}),
})

/**
 * Names are how the orchestrator addresses a persona, so two entries called
 * "reviewer" make `SPAWN reviewer:` ambiguous — it would silently pick one.
 * The library holds at most one persona per name; the later entry wins.
 */
export function dedupeByName(list: Persona[]): Persona[] {
  const byName = new Map<string, Persona>()
  for (const p of list) byName.set(p.name.trim().toLowerCase(), p)
  return [...byName.values()]
}

/**
 * Upsert by name, not id: saving an edited canvas node should update the
 * persona it came from rather than leaving two entries called "reviewer".
 */
export function upsertPersona(list: Persona[], persona: Persona): Persona[] {
  const i = list.findIndex((p) => p.name.toLowerCase() === persona.name.toLowerCase())
  if (i === -1) return [...list, persona]
  const next = [...list]
  next[i] = { ...persona, id: list[i].id }
  return next
}

export const newPersona = (): Persona => ({
  id: `persona_${rid()}`,
  name: 'new-persona',
  description: 'When the orchestrator should use this',
  provider: 'claude',
  permission: 'auto',
  effort: 'medium',
  instructions: '',
})
