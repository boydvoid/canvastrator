/**
 * The shelf: every capability an agent on this canvas can reach.
 *
 * Two kinds, and the difference decides what you can do with one. The
 * *installed* kind — the CLI's own built-ins, the user's own files, a
 * project's, a plugin's — is already loaded by the session and can only be
 * invoked. The *canvas* kind is written on a skill node here and injected into
 * whichever agents it is wired to, which makes it the only kind you can edit.
 *
 * They are listed together because from the user's side that distinction is
 * invisible until they try to change one: "what can this agent do" is a single
 * question, and answering it from two places was why nobody could answer it.
 */
import type { DiscoveredSkill } from './types'

export type SkillOrigin = 'canvas' | 'built-in' | 'user' | 'project' | 'plugin'

export type ShelfSkill = {
  /** Unique per row: a name can exist for two providers at once. */
  id: string
  name: string
  description: string
  origin: SkillOrigin
  /** The plugin's name, when the origin is a plugin. */
  source: string
  provider?: string
  kind: 'skill' | 'command'
  /** True when a session on this canvas has actually loaded it. */
  loaded: boolean
  /** The canvas node this came from, for the kind that has one. */
  nodeId?: string
}

/** What a session reported it had at startup. */
export type LoadedCapabilities = { skills: string[]; commands: string[] }

/** A capability's own name, without the plugin or namespace in front of it. */
export function bareName(name: string): string {
  const tail = name.split(':').pop() ?? name
  return tail.trim()
}

function originOf(source: string): SkillOrigin {
  if (source === 'user' || source === 'project') return source
  return 'plugin'
}

/**
 * Everything on the shelf, in the order it should be read.
 *
 * Canvas skills lead because they are the ones you are working on. Then what
 * the sessions actually loaded, then the rest of what is installed — a list
 * that opens with forty plugin skills nobody is using buries the three that
 * are.
 */
export function shelf(
  discovered: DiscoveredSkill[],
  canvas: { id: string; name: string; description: string }[],
  loaded: LoadedCapabilities[],
): ShelfSkill[] {
  const live = new Set<string>()
  for (const cap of loaded) {
    for (const n of [...cap.skills, ...cap.commands]) {
      live.add(n)
      live.add(bareName(n))
    }
  }

  const rows: ShelfSkill[] = canvas.map((c) => ({
    id: `canvas:${c.id}`,
    name: c.name,
    description: c.description,
    origin: 'canvas',
    source: 'canvas',
    kind: 'skill',
    loaded: true,
    nodeId: c.id,
  }))

  const seen = new Set(rows.map((r) => r.name))
  for (const d of discovered) {
    // A canvas skill with the same name is the one that wins: it is the one
    // the user is editing, and showing both would suggest two are running.
    if (seen.has(d.name)) continue
    seen.add(d.name)
    rows.push({
      id: `${d.provider}:${d.name}`,
      name: d.name,
      description: d.description,
      origin: originOf(d.source),
      source: d.source,
      provider: d.provider,
      kind: d.kind,
      loaded: live.has(d.name) || live.has(bareName(d.name)),
    })
  }

  // Anything a session loaded that is not on disk: the CLI's own built-ins,
  // which live inside its binary. Names only — there is nowhere to read a
  // description from — but leaving them out would mean a shelf that omits the
  // largest set of skills the agent actually has.
  for (const name of live) {
    if (seen.has(name)) continue
    // The bare form of an already-listed namespaced skill is not a new one.
    if ([...seen].some((s) => bareName(s) === name)) continue
    seen.add(name)
    rows.push({
      id: `built-in:${name}`,
      name,
      description: '',
      origin: 'built-in',
      source: 'built-in',
      kind: 'skill',
      loaded: true,
    })
  }

  const rank: Record<SkillOrigin, number> = {
    canvas: 0,
    'built-in': 2,
    user: 1,
    project: 1,
    plugin: 3,
  }
  return rows.sort(
    (a, b) =>
      rank[a.origin] - rank[b.origin] ||
      Number(b.loaded) - Number(a.loaded) ||
      a.name.localeCompare(b.name),
  )
}

/**
 * Filter by a typed query.
 *
 * Name first, description second, and never fuzzier than a substring: a shelf
 * that answers "stripe" with something called `setup-token` because both
 * contain a `t` is a shelf you stop typing into.
 */
export function search(rows: ShelfSkill[], query: string): ShelfSkill[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(
    (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
  )
}

/** The rows under each heading, in shelf order, with empty groups dropped. */
export function grouped(rows: ShelfSkill[]): { label: string; rows: ShelfSkill[] }[] {
  const out: { label: string; rows: ShelfSkill[] }[] = []
  for (const r of rows) {
    // Plugins get a heading each — "PLUGIN" alone would put eight stripe
    // skills and one design skill under one meaningless label.
    const label = r.origin === 'plugin' ? `plugin · ${r.source}` : r.origin
    const last = out[out.length - 1]
    if (last?.label === label) last.rows.push(r)
    else out.push({ label, rows: [r] })
  }
  return out
}
