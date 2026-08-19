/**
 * One read of a file, shared by every agent on the canvas that wants it.
 *
 * A file node wired into three sessions used to be read from disk three
 * times, once per turn, and injected into all three prompts in full on every
 * turn thereafter — the same bytes, re-sent to an agent that already had them
 * in its history. This module fixes the first half: the read is done once and
 * handed out. The second half is the digest, which lets a caller ask whether
 * what it holds has actually changed before paying to send it again.
 */
import { readFileHead, type FilePeek } from './bridge'

/**
 * How long a read is reused.
 *
 * Long enough to cover a burst — an orchestrator spawning four workers has
 * them all open the same files within a second or so — and short enough that
 * an agent which just edited a file sees its own write on the next turn. This
 * is a cache of a snapshot, not a view of the filesystem, and the window is
 * deliberately too short to be mistaken for one.
 */
export const CACHE_TTL_MS = 2000

type Entry = { at: number; maxBytes: number; peek: FilePeek }

const cache = new Map<string, Entry>()

/** Injected in tests, where there is no Tauri backend to read from. */
export type Reader = (path: string, maxBytes: number) => Promise<FilePeek>

export type ReadOpts = { read?: Reader; now?: number }

/**
 * A file's contents, from the cache when they were read recently enough.
 *
 * A hit must also have been read with at least the budget being asked for
 * now, or a caller with room for 24KB would be served the 2KB another agent's
 * tighter budget produced, and silently believe the file ends there.
 */
export async function readShared(
  path: string,
  maxBytes: number,
  opts: ReadOpts = {},
): Promise<FilePeek> {
  const read = opts.read ?? readFileHead
  const now = opts.now ?? Date.now()

  const hit = cache.get(path)
  if (hit && now - hit.at < CACHE_TTL_MS && hit.maxBytes >= maxBytes) {
    // Serve at the size asked for, not the size cached, so a smaller budget
    // gets a smaller answer and still reports itself as truncated.
    if (hit.peek.text.length <= maxBytes) return hit.peek
    return { ...hit.peek, text: hit.peek.text.slice(0, maxBytes), truncated: true }
  }

  const peek = await read(path, maxBytes)
  cache.set(path, { at: now, maxBytes, peek })
  return peek
}

/**
 * Drop everything.
 *
 * Nothing in the app needs this — the TTL is shorter than any switch between
 * canvases — but a test that shares a snapshot with the test before it is a
 * test that passes for the wrong reason.
 */
export function clearFileCache() {
  cache.clear()
}

/**
 * A short stable fingerprint of some text — FNV-1a, as hex.
 *
 * Only ever compared against another digest of the same function, so it needs
 * to be fast and stable, not cryptographic. Collisions would show up as a
 * changed file that failed to be re-sent; at 32 bits over the handful of files
 * one session holds, that is not a risk worth a real hash for.
 */
export function digest(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
