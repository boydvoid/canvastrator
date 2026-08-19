import { beforeEach, describe, expect, it } from 'vitest'
import { CACHE_TTL_MS, clearFileCache, digest, readShared } from './filecache'

const reader = (text: string, truncated = false) => {
  let calls = 0
  const read = async (_path: string, maxBytes: number) => {
    calls++
    return {
      text: text.slice(0, maxBytes),
      bytes: text.length,
      truncated: truncated || text.length > maxBytes,
      binary: false,
    }
  }
  return { read, calls: () => calls }
}

describe('readShared', () => {
  beforeEach(clearFileCache)

  it('reads a file once for every agent that wants it', async () => {
    const r = reader('hello')
    await readShared('/a', 100, { read: r.read, now: 0 })
    await readShared('/a', 100, { read: r.read, now: 500 })
    await readShared('/a', 100, { read: r.read, now: 1500 })
    expect(r.calls()).toBe(1)
  })

  it('reads again once the snapshot is stale', async () => {
    const r = reader('hello')
    await readShared('/a', 100, { read: r.read, now: 0 })
    await readShared('/a', 100, { read: r.read, now: CACHE_TTL_MS })
    expect(r.calls()).toBe(2)
  })

  it('keeps files apart', async () => {
    const r = reader('hello')
    await readShared('/a', 100, { read: r.read, now: 0 })
    await readShared('/b', 100, { read: r.read, now: 0 })
    expect(r.calls()).toBe(2)
  })

  it('does not serve a small cached read to a caller with room for more', async () => {
    // Otherwise a tight budget poisons the cache and the next caller believes
    // the file ends where the first one stopped reading.
    const r = reader('0123456789')
    const small = await readShared('/a', 4, { read: r.read, now: 0 })
    expect(small.text).toBe('0123')
    const big = await readShared('/a', 100, { read: r.read, now: 10 })
    expect(big.text).toBe('0123456789')
    expect(r.calls()).toBe(2)
  })

  it('cuts a cached read down for a caller asking for less, and says it is cut', async () => {
    const r = reader('0123456789')
    await readShared('/a', 100, { read: r.read, now: 0 })
    const small = await readShared('/a', 4, { read: r.read, now: 10 })
    expect(small.text).toBe('0123')
    expect(small.truncated).toBe(true)
    expect(r.calls()).toBe(1)
  })

  it('lets an error through rather than caching it', async () => {
    let calls = 0
    const read = async () => {
      calls++
      throw new Error('gone')
    }
    await expect(readShared('/a', 100, { read, now: 0 })).rejects.toThrow('gone')
    await expect(readShared('/a', 100, { read, now: 10 })).rejects.toThrow('gone')
    expect(calls).toBe(2)
  })
})

describe('digest', () => {
  it('is stable for the same text', () => {
    expect(digest('const a = 1')).toBe(digest('const a = 1'))
  })

  it('changes when the text does, including in whitespace', () => {
    expect(digest('a')).not.toBe(digest('b'))
    expect(digest('a b')).not.toBe(digest('a  b'))
    expect(digest('')).not.toBe(digest(' '))
  })

  it('is fixed width, so it is cheap to store per file', () => {
    for (const s of ['', 'a', 'x'.repeat(10_000)]) {
      expect(digest(s)).toHaveLength(8)
    }
  })
})
