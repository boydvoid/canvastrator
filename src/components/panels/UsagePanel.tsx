import { Gauge } from 'lucide-react'
import { FloatingPanel } from '@/components/panels/FloatingPanel'
import { runSince } from '@/lib/pulse'
import { useStore, type GtNode } from '@/lib/store'
import {
  band,
  burnRate,
  canvasUsage,
  contextUse,
  fmtTokens,
  fmtUsd,
  spendByAgent,
  type SessionLike,
} from '@/lib/usage'
import { PROVIDER_ACCENT } from '@/lib/types'
import { cn } from '@/lib/utils'

const BAND_COLOR = {
  calm: 'var(--color-live)',
  warm: 'var(--color-claude)',
  hot: 'var(--color-danger)',
} as const

/** One headline figure. Three of them across the top, in one row. */
function Figure({ value, label, strong }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        className={cn(
          'truncate font-slab text-[19px] leading-none font-medium tabular-nums',
          strong ? 'text-fg-strong' : 'text-fg-muted',
        )}
      >
        {value}
      </span>
      <span className="truncate font-mono text-[9px] text-fg-faint">{label}</span>
    </div>
  )
}

/** One agent's window, as a bar you read across a column of them. */
function ContextRow({ s }: { s: SessionLike }) {
  const use = contextUse(s)
  const tone = band(use?.fraction ?? null)
  return (
    <li className="flex items-center gap-2">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: PROVIDER_ACCENT[s.provider] }}
      />
      <span className="w-[84px] shrink-0 truncate font-mono text-[10px] text-fg-muted" title={s.name}>
        {s.name}
      </span>
      {/* An unknown window gets the space but no bar. A rail with nothing in
          it reads as "empty", which is the one thing it must not say. */}
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
        {use?.fraction != null && (
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(2, use.fraction * 100)}%`, background: BAND_COLOR[tone] }}
          />
        )}
      </span>
      <span
        className={cn(
          'w-8 shrink-0 text-right font-mono text-[10px] tabular-nums',
          tone === 'hot' ? 'text-[var(--color-danger)]' : 'text-fg-subtle',
        )}
        title={
          use
            ? `Last turn carried ${use.tokens.toLocaleString()} context tokens${
                use.limit ? ` of ${use.limit.toLocaleString()}` : ' — window unknown for this model'
              }`
            : 'No turn has run yet'
        }
      >
        {use?.fraction != null ? `${Math.round(use.fraction * 100)}%` : use ? fmtTokens(use.tokens) : '—'}
      </span>
    </li>
  )
}

/**
 * What this canvas is spending, as a panel that floats over it.
 *
 * Cost used to be one number in the title bar, which is the right place for a
 * total and the wrong place for everything that makes it actionable: by the
 * time a squad has run, "$4.10" says it was expensive and nothing about which
 * agent made it so, or whether it is still climbing.
 *
 * So three questions, in the order you ask them. What has it cost. How fast is
 * that still growing. And — the one that decides whether a long task survives
 * — how full is each agent's window. The last is not a cost at all, but it is
 * asked at the same moment, and separating them into two surfaces would mean
 * looking in two places to answer "can this keep going".
 *
 * Everything here is derived on render — the panel stores nothing but whether
 * it is open, which is the whole reason it can float rather than be placed.
 */
export function UsagePanel() {
  const nodes = useStore((s) => s.nodes)
  // The run's start, taken from the oldest event the feed still holds. See
  // `runSince`: on a very long canvas this measures the window the feed
  // covers, not all of history, which is the honest reading next to a rate.
  const since = useStore((s) => runSince(s.notifications))

  const sessions: SessionLike[] = nodes
    .filter((n): n is GtNode & { type: 'session' } => n.type === 'session')
    .map((n) => ({ ...n.data, id: n.id }))

  const total = canvasUsage(sessions)
  const rate = since ? burnRate(total.costUsd, Date.now() - since) : null
  const shares = spendByAgent(sessions).filter((s) => s.costUsd > 0)

  return (
    <FloatingPanel
      panel="usage"
      title="USAGE"
      Icon={Gauge}
      badge={
        // The total belongs in the header: it is the figure you keep an eye
        // on, and a minimized Usage should still carry it.
        <span className="font-mono text-[9.5px] text-fg-subtle tabular-nums">
          {fmtUsd(total.costUsd)} this canvas
        </span>
      }
    >
      {sessions.length === 0 ? (
        <p className="px-3 py-4 text-[11px] leading-snug text-fg-faint">
          No agents yet. Spawn one and its spend and context window appear here.
        </p>
      ) : (
        <>
          <div className="flex gap-3 px-3 pt-3 pb-2.5">
            <Figure value={fmtUsd(total.costUsd)} label="spent" strong />
            <Figure
              value={rate != null ? fmtUsd(rate) : '—'}
              label={rate != null ? 'per 10 min' : 'rate — too early'}
            />
            <Figure value={String(total.sessions)} label={total.sessions === 1 ? 'agent' : 'agents'} />
          </div>

          <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">
                CONTEXT WINDOW
              </span>
              <span className="ml-auto font-mono text-[9px] text-fg-faint">
                the one that ends a run
              </span>
            </div>
            <ul className="max-h-32 space-y-1.5 overflow-y-auto overscroll-contain">
              {sessions.map((s) => (
                <ContextRow key={s.id} s={s} />
              ))}
            </ul>
          </div>

          {shares.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
              <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">
                SPEND BY AGENT
              </span>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-sm">
                {shares.map((s) => (
                  <span
                    key={s.id}
                    className="h-full rounded-[1px]"
                    style={{
                      width: `${Math.max(1, s.fraction * 100)}%`,
                      background: PROVIDER_ACCENT[s.provider],
                    }}
                    title={`${s.name} — ${fmtUsd(s.costUsd)}`}
                  />
                ))}
              </div>
              {/* Four is where a legend stops being read and starts being
                  decoration; the bar and the tooltips still carry the rest. */}
              <div className="flex gap-3">
                {shares.slice(0, 4).map((s) => (
                  <div key={s.id} className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-mono text-[10.5px] text-fg tabular-nums">
                      {fmtUsd(s.costUsd)}
                    </span>
                    <span className="truncate font-mono text-[8px] text-fg-faint">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-line bg-canvas/40 px-3 py-1.5 font-mono text-[9.5px] text-fg-faint tabular-nums">
            <span title="Tokens billed as fresh input across every agent">
              in {fmtTokens(total.inputTokens)}
            </span>
            <span title="Tokens generated across every agent">
              out {fmtTokens(total.outputTokens)}
            </span>
            {/* The agent nearest its ceiling is the one that will fail first,
                and the reason to look at this panel before starting something
                long. */}
            {total.tightest?.use.fraction != null && (
              <span
                className={cn(
                  'ml-auto truncate',
                  band(total.tightest.use.fraction) === 'hot' && 'text-[var(--color-danger)]',
                )}
                title="The fullest context window on this canvas"
              >
                fullest {total.tightest.name} {Math.round(total.tightest.use.fraction * 100)}%
              </span>
            )}
          </div>
        </>
      )}
    </FloatingPanel>
  )
}
