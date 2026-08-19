import { useStore } from '@/lib/store'
import { band, contextUse, fmtTokens } from '@/lib/usage'
import { cn } from '@/lib/utils'

/**
 * How full the context window is, at the top of the window.
 *
 * The one failure a canvas of agents cannot recover from is an agent whose
 * window fills up mid-task: the turn fails, or the provider silently drops the
 * front of the conversation, and either way the work already done is what gets
 * lost. That is knowable in advance — every turn reports the prompt it
 * carried — but only if something is watching, which is what this is.
 *
 * It follows the agent the chat panel is pointed at, because that is the one
 * you are about to type into. When nothing is selected it shows the fullest
 * window on the canvas instead: with several agents running, the interesting
 * one is whichever is closest to the edge, not whichever was clicked last.
 */
export function ContextMeter() {
  const nodes = useStore((s) => s.nodes)
  const target = useStore((s) => s.chatTarget)

  const sessions = nodes.filter((n) => n.type === 'session')
  const focused = sessions.find((n) => n.id === target)

  // The focused agent even when its window is unknown — following the
  // selection and then quietly showing a different agent's number would be
  // worse than showing nothing.
  const pick = focused
    ? { name: focused.data.name, use: contextUse({ ...focused.data, id: focused.id }) }
    : sessions
        .map((n) => ({ name: n.data.name, use: contextUse({ ...n.data, id: n.id }) }))
        .filter((x) => x.use?.fraction != null)
        .sort((a, b) => (b.use?.fraction ?? 0) - (a.use?.fraction ?? 0))[0]

  if (!pick?.use) return null

  const { tokens, limit, fraction } = pick.use
  const tone = band(fraction)

  return (
    <span
      className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums"
      title={
        limit
          ? `${pick.name}: the last turn carried ${tokens.toLocaleString()} of ${limit.toLocaleString()} context tokens. The whole conversation is resent every turn, so this is how big it has become.`
          : `${pick.name}: the last turn carried ${tokens.toLocaleString()} context tokens. The window for this model is unknown, so there is no percentage to show.`
      }
    >
      <span className="text-fg-faint">ctx</span>
      {/* No bar without a denominator — a bar implies a proportion, and half
          of an unknown window is not a thing anyone can draw honestly. */}
      {fraction != null && (
        <span className="h-1 w-14 overflow-hidden rounded-full bg-surface-2">
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.max(2, fraction * 100)}%`,
              background:
                tone === 'hot'
                  ? 'var(--color-danger)'
                  : tone === 'warm'
                    ? 'var(--color-claude)'
                    : 'var(--color-live)',
            }}
          />
        </span>
      )}
      <span
        className={cn(
          tone === 'hot' ? 'text-[var(--color-danger)]' : 'text-fg-muted',
          tone === 'warm' && 'text-fg',
        )}
      >
        {fmtTokens(tokens)}
        {limit ? ` / ${fmtTokens(limit)}` : ''}
      </span>
    </span>
  )
}
