/**
 * Line diffing, and reverting one change at a time.
 *
 * Monaco renders a diff but won't let you act on part of one, and acting on
 * part of one is the whole point: an agent's edit is usually several unrelated
 * changes and you want three of them, not all four.
 */

export type Hunk = {
  /** 0-based line index in the original where the change starts. */
  originalStart: number
  originalLines: string[]
  /** 0-based line index in the modified text where the change starts. */
  modifiedStart: number
  modifiedLines: string[]
}

export const splitLines = (text: string): string[] => (text === '' ? [] : text.split('\n'))

/**
 * Longest common subsequence over lines.
 *
 * Quadratic, which is fine for a file someone is reading — and bounded below,
 * because a pathological pair would otherwise lock the UI while they scroll.
 */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const w = b.length + 1
  const table = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] =
        a[i] === b[j]
          ? table[(i + 1) * w + j + 1] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + j + 1])
    }
  }
  return table
}

/** Beyond this, fall back to one whole-file hunk rather than stalling. */
const MAX_LINES_FOR_LCS = 4000

export function computeHunks(originalText: string, modifiedText: string): Hunk[] {
  const a = splitLines(originalText)
  const b = splitLines(modifiedText)

  if (originalText === modifiedText) return []

  if (a.length > MAX_LINES_FOR_LCS || b.length > MAX_LINES_FOR_LCS) {
    return [{ originalStart: 0, originalLines: a, modifiedStart: 0, modifiedLines: b }]
  }

  const w = b.length + 1
  const table = lcsTable(a, b)
  const hunks: Hunk[] = []

  let i = 0
  let j = 0
  let pending: Hunk | null = null

  const flush = () => {
    if (pending) hunks.push(pending)
    pending = null
  }

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush()
      i++
      j++
      continue
    }
    pending ??= { originalStart: i, originalLines: [], modifiedStart: j, modifiedLines: [] }
    // Follow the table: whichever side the LCS doesn't need, consume.
    if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
      pending.originalLines.push(a[i++])
    } else {
      pending.modifiedLines.push(b[j++])
    }
  }
  // Whatever is left on either side is a trailing change.
  while (i < a.length) {
    pending ??= { originalStart: i, originalLines: [], modifiedStart: j, modifiedLines: [] }
    pending.originalLines.push(a[i++])
  }
  while (j < b.length) {
    pending ??= { originalStart: i, originalLines: [], modifiedStart: j, modifiedLines: [] }
    pending.modifiedLines.push(b[j++])
  }
  flush()

  return hunks
}

/**
 * Put one hunk back to its original form, leaving every other change alone.
 *
 * Applied against the *current* modified text rather than a remembered
 * position, so reverting hunk 3 after hunk 1 doesn't act on stale line
 * numbers — the caller recomputes hunks between operations.
 */
export function revertHunk(originalText: string, modifiedText: string, index: number): string {
  const hunks = computeHunks(originalText, modifiedText)
  const hunk = hunks[index]
  if (!hunk) return modifiedText

  const lines = splitLines(modifiedText)
  const before = lines.slice(0, hunk.modifiedStart)
  const after = lines.slice(hunk.modifiedStart + hunk.modifiedLines.length)
  return [...before, ...hunk.originalLines, ...after].join('\n')
}

/** What a hunk did, for labelling it. */
export function describeHunk(h: Hunk): 'added' | 'removed' | 'changed' {
  if (!h.originalLines.length) return 'added'
  if (!h.modifiedLines.length) return 'removed'
  return 'changed'
}

/** 1-based line range in the modified file, for showing where a hunk is. */
export function hunkRange(h: Hunk): string {
  const start = h.modifiedStart + 1
  const count = h.modifiedLines.length
  if (!count) return `after line ${h.modifiedStart}`
  return count === 1 ? `line ${start}` : `lines ${start}–${start + count - 1}`
}
