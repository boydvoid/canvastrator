import { useStore } from './store'
import type { SessionNodeData } from './types'

/** What an agent is doing to a file, right now. */
export type Touch = 'read' | 'write'

/**
 * A file is *live* while the agent that touched it is still inside the turn
 * that touched it. Tool calls arrive as instants, so "in flight" can't be
 * observed directly — but a touch stamped after the current turn began, on a
 * session that's still working, is exactly the file that turn is on. When the
 * turn ends the animation stops on its own, with nothing to clean up.
 */
/**
 * The rule, on its own: the touch happened inside the turn that's still
 * running. A touch from a previous turn on a session that's busy again is a
 * file it worked on before, not one it's on now.
 */
export function isTouchLive(session: SessionNodeData, at?: number): boolean {
  if (!at) return false
  if (session.state !== 'thinking' && session.state !== 'streaming') return false
  return at >= (session.turnStartedAt ?? 0)
}

export function useFileActivity(fileNodeId: string): Touch | null {
  return useStore((s) => {
    for (const e of s.edges) {
      if (e.type !== 'file' || e.target !== fileNodeId) continue
      const at = (e.data as { at?: number } | undefined)?.at
      if (!at) continue
      const session = s.nodes.find((n) => n.id === e.source)
      if (!session || session.type !== 'session') continue
      if (!isTouchLive(session.data, at)) continue
      return (e.data as { write?: boolean }).write ? 'write' : 'read'
    }
    return null
  })
}

/** The same question asked from the edge's end. */
export function useTouchLive(sessionNodeId: string, at?: number): boolean {
  return useStore((s) => {
    const session = s.nodes.find((n) => n.id === sessionNodeId)
    if (!session || session.type !== 'session') return false
    return isTouchLive(session.data, at)
  })
}
