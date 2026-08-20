/**
 * What the agents actually changed, and how much.
 *
 * The canvas shows *that* a file was written — a green edge, a node with a
 * pen on it — and nothing about the size of the change. "Touched store.ts" is
 * the same sentence whether an agent fixed a typo or rewrote the module, and
 * those are not the same thing to somebody deciding whether to keep it.
 *
 * The baseline is git HEAD, which is both the only "before" that exists (an
 * agent edits in place and the tool call arrives after the fact) and the one a
 * user already reasons about: what changed since my last commit.
 */
import { fileDiffBase, readFileHead } from './bridge'
import { computeHunks } from './hunks'

export type Landed = {
  path: string
  /** Lines added and removed against HEAD. */
  added: number
  removed: number
  /**
   * Why there are no numbers, when there are none. A file git has never seen
   * is not an error — it is a new file, and that is a diff against nothing.
   */
  reason: string | null
  /** True when git has no version of this file at all. */
  untracked: boolean
}

/**
 * How much of a file to read for a line count.
 *
 * Generous, because a truncated read makes the removed-line count look
 * enormous — everything past the cut reads as deleted. Past this the count is
 * refused rather than guessed at; see `diffStat`.
 */
export const STAT_BUDGET = 400_000

/** Lines added and removed in one file, against its committed version. */
export async function diffStat(
  path: string,
  read = readFileHead,
  base = fileDiffBase,
): Promise<Landed> {
  const empty = (reason: string, untracked = false): Landed => ({
    path,
    added: 0,
    removed: 0,
    reason,
    untracked,
  })

  const [now, head] = await Promise.all([
    read(path, STAT_BUDGET).catch(() => null),
    base(path).catch(() => null),
  ])

  if (!now) return empty('could not be read')
  if (now.binary) return empty('binary')
  // A file too large to read whole would report everything past the cut as
  // deleted, which is worse than saying nothing.
  if (now.truncated) return empty('too large to count')
  if (!head) return empty('no baseline')
  if (head.original == null) {
    // Untracked, or added since HEAD: every line in it is new.
    const added = now.text === '' ? 0 : now.text.split('\n').length
    return { path, added, removed: 0, reason: head.reason, untracked: true }
  }

  let added = 0
  let removed = 0
  for (const h of computeHunks(head.original, now.text)) {
    added += h.modifiedLines.length
    removed += h.originalLines.length
  }
  return { path, added, removed, reason: null, untracked: false }
}

/** Formats a stat for a row you scan rather than read. */
export function statLabel(l: Landed): string {
  if (l.reason && !l.untracked) return l.reason
  if (l.added === 0 && l.removed === 0) return 'no change'
  return `+${l.added} −${l.removed}`
}
