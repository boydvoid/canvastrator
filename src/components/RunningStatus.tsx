import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { SessionNodeData } from '@/lib/types'

/** Ticks once a second while a turn is in flight, and not otherwise. */
export function useElapsed(since: number | undefined, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || !since) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active, since])
  if (!active || !since) return null
  return Math.max(0, Math.floor((now - since) / 1000))
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/**
 * What a working agent is doing right now.
 *
 * A long turn used to show nothing but the word "thinking", which is
 * indistinguishable from a hung one — the whole reason someone reaches for the
 * stop button. Elapsed time proves it's alive; the last tool proves it's
 * getting somewhere.
 */
export function RunningStatus({
  data,
  className,
}: {
  data: SessionNodeData
  className?: string
}) {
  const busy = data.state === 'thinking' || data.state === 'streaming'
  const elapsed = useElapsed(data.turnStartedAt, busy)
  if (!busy) return null

  const lastTool = data.messages.at(-1)?.tools.at(-1)

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-fg-muted',
        className,
      )}
    >
      <span className="gt-caret shrink-0">●</span>
      {elapsed !== null && <span className="shrink-0 tabular-nums">{formatElapsed(elapsed)}</span>}
      {data.notice ? (
        <span className="truncate text-fg" title={data.notice.detail}>
          {data.notice.label}
        </span>
      ) : lastTool ? (
        <span className="truncate opacity-80" title={lastTool.detail}>
          {lastTool.name}
          {lastTool.detail ? ` ${lastTool.detail.split('/').pop()}` : ''}
        </span>
      ) : (
        <span className="truncate opacity-60">{data.state}</span>
      )}
      {/* A turn this long is usually waiting on the provider, not stuck. */}
      {elapsed !== null && elapsed > 120 && (
        <span className="shrink-0 text-fg-faint">still working</span>
      )}
    </div>
  )
}
