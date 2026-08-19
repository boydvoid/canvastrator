import { EFFORTS, EFFORT_HINT, type Effort } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * How hard a persona thinks before answering. A fixed ladder rather than free
 * text, because — unlike models — every CLI takes the same small set and a
 * typo would be silently ignored by the provider. Unset means the CLI's own
 * default, which is the right default: it follows the user's provider config.
 */
export function EffortField({
  value,
  onChange,
  className,
}: {
  value?: Effort
  /** Undefined is "unset" — take whatever the provider defaults to. */
  onChange: (effort: Effort | undefined) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <span className="shrink-0 font-mono text-[10px] text-fg-faint">effort</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {EFFORTS.map((e) => (
          <button
            key={e}
            // Clicking the current level again clears it, so the provider
            // default stays reachable without a separate control.
            onClick={() => onChange(value === e ? undefined : e)}
            title={EFFORT_HINT[e]}
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
              value === e ? 'bg-surface-3 text-fg' : 'text-fg-subtle hover:bg-surface',
            )}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
