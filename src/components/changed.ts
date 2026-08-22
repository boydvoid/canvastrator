import { useEffect, useMemo, useState } from 'react'
import { diffStat, type Change } from '@/lib/changes'
import { useStore, type GtNode } from '@/lib/store'

/** A row before its numbers arrive. Never zero — zero is a claim. */
const PENDING: Omit<Change, 'path'> = { added: 0, removed: 0, reason: 'counting…', untracked: false }

export type ChangedFile = { id: string; path: string; touchedAt?: number }

/**
 * Line counts for the listed files, fetched once each and kept.
 *
 * Keyed by path *and* by the moment it was touched, so a file an agent writes
 * again is re-counted and one that has not changed is not. Two shell-outs to
 * git per file is not something to repeat on every render of a surface that
 * sits on screen for an hour.
 */
export function useStats(files: ChangedFile[]) {
  const [stats, setStats] = useState<Record<string, Change>>({})
  const key = files.map((f) => `${f.path}@${f.touchedAt ?? 0}`).join('\n')

  useEffect(() => {
    let live = true
    const wanted = key ? key.split('\n') : []
    for (const entry of wanted) {
      const path = entry.slice(0, entry.lastIndexOf('@'))
      void diffStat(path).then((stat) => {
        if (live) setStats((prev) => ({ ...prev, [entry]: stat }))
      })
    }
    return () => {
      live = false
    }
  }, [key])

  return (file: ChangedFile) =>
    stats[`${file.path}@${file.touchedAt ?? 0}`] ?? { path: file.path, ...PENDING }
}

/**
 * Every file the agents on this canvas have written, newest first.
 *
 * Newest first because the change you are deciding about is the one that just
 * landed, not the one from forty minutes ago.
 */
export function useChangedFiles(): ChangedFile[] {
  const nodes = useStore((s) => s.nodes)
  return useMemo(
    () =>
      nodes
        .filter((n): n is GtNode & { type: 'file' } => n.type === 'file' && n.data.written === true)
        .map((n) => ({ id: n.id, path: n.data.path, touchedAt: n.data.touchedAt }))
        .sort((a, b) => (b.touchedAt ?? 0) - (a.touchedAt ?? 0)),
    [nodes],
  )
}

/** Who wrote each file, read off the edge that recorded the touch. */
export function useAuthors(): Record<string, string> {
  const authors = useStore((s) => {
    const by: Record<string, string> = {}
    for (const e of s.edges) {
      if (e.type !== 'file' || !(e.data as { write?: boolean } | undefined)?.write) continue
      const from = s.nodes.find((n) => n.id === e.source)
      if (from?.type === 'session') by[e.target] = from.data.name
    }
    return Object.entries(by)
      .map(([k, v]) => `${k} ${v}`)
      .join('\n')
  })
  return useMemo(() => {
    const map: Record<string, string> = {}
    for (const row of authors ? authors.split('\n') : []) {
      const [id, name] = row.split(' ')
      map[id] = name
    }
    return map
  }, [authors])
}
