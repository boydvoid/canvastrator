import { MODEL_HINT, MODEL_OPTIONS, type Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Which model a persona runs on. The provider's models are offered as
 * one-click options — read from MODEL_OPTIONS, the single place they are
 * defined — alongside a free-text box, because every provider takes
 * `--model <string>` and the list of models changes far more often than this
 * app ships; a closed dropdown would be wrong within a month. `default` means
 * "whatever the CLI defaults to", which is the right default: it follows the
 * user's own provider config.
 */
export function ModelField({
  provider,
  value,
  onChange,
  className,
}: {
  provider: Provider
  value?: string
  /** Empty string is normalised to undefined — "unset", not "" on the wire. */
  onChange: (model: string | undefined) => void
  className?: string
}) {
  const options = MODEL_OPTIONS[provider]
  const set = (m: string) => onChange(m.trim() || undefined)

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center gap-1">
        <span className="shrink-0 font-mono text-[10px] text-fg-faint">model</span>
        <input
          value={value ?? ''}
          onChange={(e) => set(e.target.value)}
          placeholder={MODEL_HINT[provider]}
          spellCheck={false}
          className="nodrag min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
          title={`Leave empty to use ${provider}'s own default model.`}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => onChange(undefined)}
          title={`Use ${provider}'s own default model.`}
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
            value ? 'text-fg-subtle hover:bg-surface' : 'bg-surface-3 text-fg',
          )}
        >
          default
        </button>
        {options.map((m) => (
          <button
            key={m.id}
            onClick={() => set(m.id)}
            // The id is what the CLI is sent, so keep it one hover away even
            // though the button reads as a name.
            title={m.id}
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
              value === m.id ? 'bg-surface-3 text-fg' : 'text-fg-subtle hover:bg-surface',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}
