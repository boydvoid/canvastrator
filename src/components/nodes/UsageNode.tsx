import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { useStore, type GtNode } from '@/lib/store'
import { band, canvasUsage, contextUse, fmtTokens, fmtUsd, type SessionLike } from '@/lib/usage'
import { cn } from '@/lib/utils'

const TONE = {
  calm: 'var(--color-live)',
  warm: 'var(--color-claude)',
  hot: 'var(--color-danger)',
} as const

/** One agent's line: what it has cost, and how full its window is. */
function Row({ s }: { s: SessionLike }) {
  const use = contextUse(s)
  const tone = band(use?.fraction ?? null)

  return (
    <li className="flex items-center gap-1.5">
      <span className="w-[86px] shrink-0 truncate font-mono text-[10px] text-fg" title={s.name}>
        {s.name}
      </span>

      {/* The window, when there is one to draw. An unknown window gets the
          space but no bar: a rail with nothing in it reads as "empty", which
          is the one thing it must not say. */}
      <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface-2">
        {use?.fraction != null && (
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(2, use.fraction * 100)}%`, background: TONE[tone] }}
          />
        )}
      </span>

      <span
        className={cn(
          'w-11 shrink-0 text-right font-mono text-[9.5px] tabular-nums',
          tone === 'hot' ? 'text-[var(--color-danger)]' : 'text-fg-muted',
        )}
        title={
          use
            ? `last turn carried ${use.tokens.toLocaleString()} context tokens${
                use.limit ? ` of ${use.limit.toLocaleString()}` : ' — window unknown for this model'
              }`
            : 'no turn has run yet'
        }
      >
        {use ? fmtTokens(use.tokens) : '—'}
      </span>

      <span className="ml-auto shrink-0 font-mono text-[9.5px] text-fg-faint tabular-nums">
        {fmtUsd(s.usage.costUsd)}
      </span>
    </li>
  )
}

/**
 * What this canvas has spent, on the canvas.
 *
 * Cost was already totalled in the title bar, which is the right place for one
 * number and the wrong place for the breakdown: by the time a squad has run,
 * "$4.10" tells you it was expensive and nothing about which agent made it so.
 * This is the same figures per agent, next to the agents themselves — and it
 * carries the context meters too, because "how much has it cost" and "how much
 * room is left" are the two questions you ask at the same moment.
 *
 * Everything here is derived on render. The node stores nothing but its id.
 */
function UsageNodeInner({ selected }: NodeProps<GtNode & { type: 'usage' }>) {
  const nodes = useStore((s) => s.nodes)

  const sessions: SessionLike[] = nodes
    .filter((n): n is GtNode & { type: 'session' } => n.type === 'session')
    .map((n) => ({ ...n.data, id: n.id }))

  const total = canvasUsage(sessions)

  return (
    <div
      className={cn(
        'gt-spawn flex w-[300px] flex-col gap-1.5 rounded-lg border bg-panel/90 px-2.5 py-2 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[11px] text-fg">usage</span>
        <span className="font-mono text-[9.5px] text-fg-faint">
          {total.sessions} agent{total.sessions === 1 ? '' : 's'}
        </span>
        <span className="ml-auto font-mono text-[11px] text-fg tabular-nums">
          {fmtUsd(total.costUsd)}
        </span>
      </div>

      {sessions.length === 0 ? (
        <p className="font-mono text-[9.5px] leading-relaxed text-fg-faint">
          No agents yet. Spawn one and its cost and context window appear here.
        </p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto overscroll-contain">
          {sessions.map((s) => (
            <Row key={s.id} s={s} />
          ))}
        </ul>
      )}

      <div className="flex items-baseline gap-2 border-t border-line-soft pt-1 font-mono text-[9.5px] text-fg-faint tabular-nums">
        <span title="Tokens billed as fresh input across every agent, summed over the whole canvas">
          in {fmtTokens(total.inputTokens)}
        </span>
        <span title="Tokens generated across every agent">
          out {fmtTokens(total.outputTokens)}
        </span>
        {/* The agent nearest its ceiling, which is the one that will fail
            first — and the reason to look at this node before starting
            something long. */}
        {total.tightest?.use.fraction != null && (
          <span
            className={cn(
              'ml-auto',
              band(total.tightest.use.fraction) === 'hot' && 'text-[var(--color-danger)]',
            )}
            title="The fullest context window on this canvas"
          >
            fullest {total.tightest.name} {Math.round(total.tightest.use.fraction * 100)}%
          </span>
        )}
      </div>
    </div>
  )
}

export const UsageNode = memo(UsageNodeInner)
