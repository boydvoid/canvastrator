import { useEffect, useState } from 'react'
import { CircleDot, Gauge } from 'lucide-react'
import { FloatingPanel } from '@/components/panels/FloatingPanel'
import { planUsage, type PlanUsage } from '@/lib/bridge'
import { shouldOffer } from '@/lib/compact'
import { runSince } from '@/lib/pulse'
import { useStore, type GtNode } from '@/lib/store'
import {
  band,
  burnRate,
  canvasUsage,
  contextUse,
  fmtTokens,
  fmtUsd,
  planBand,
  spendByAgent,
  untilReset,
  type SessionLike,
} from '@/lib/usage'
import { PROVIDER_ACCENT } from '@/lib/types'
import { cn } from '@/lib/utils'

const BAND_COLOR = {
  calm: 'var(--color-live)',
  warm: 'var(--color-claude)',
  hot: 'var(--color-danger)',
} as const

/**
 * What the plan has left, refreshed while the panel is open.
 *
 * Polled rather than pushed: the figure comes from a separate short-lived
 * process, so it cannot ride along on a turn. A minute is slow enough that the
 * process cost is nothing and fast enough that a window filling up during a
 * long squad run is visible before it stops the run.
 *
 * Nothing is fetched while the panel is closed. The panel is always mounted —
 * it is the header that disappears, not the component — so being closed has to
 * be asked for rather than assumed. It matters more than a saved subprocess:
 * the read shells out to the CLI, and a spawn on launch is a spawn nobody
 * asked for, which macOS asks the user about.
 */
function usePlan(open: boolean): PlanUsage | null {
  const [plan, setPlan] = useState<PlanUsage | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    const read = () =>
      planUsage()
        .then((p) => live && setPlan(p))
        // A CLI that cannot answer leaves the panel on money, which is what it
        // showed before any of this existed.
        .catch(() => live && setPlan(null))
    void read()
    const t = setInterval(read, 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [open])

  return plan
}

const BAND_TEXT = {
  calm: 'text-fg-subtle',
  warm: 'text-[var(--color-claude)]',
  hot: 'text-[var(--color-danger)]',
} as const

/**
 * One plan window: how much of it is gone, and when it comes back.
 *
 * The reset is half the answer. "83% of your session window" reads as an
 * emergency on its own and as a shrug when the window turns over in nine
 * minutes, and only one of those should stop you starting a squad.
 */
function WindowRow({ w }: { w: PlanUsage['windows'][number] }) {
  const tone = planBand(w.percent)
  const resets = untilReset(w.resetsAt)
  return (
    <li className="flex items-center gap-[9px]">
      <span className="w-[82px] shrink-0 truncate font-mono text-[10px] text-fg-muted">
        {w.label}
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(2, Math.min(100, w.percent))}%`, background: BAND_COLOR[tone] }}
        />
      </span>
      <span className={cn('w-7 shrink-0 text-right font-mono text-[10px] tabular-nums', BAND_TEXT[tone])}>
        {Math.round(w.percent)}%
      </span>
      <span className="w-[52px] shrink-0 text-right font-mono text-[9px] text-fg-faint tabular-nums">
        {resets ? `${resets}` : '—'}
      </span>
    </li>
  )
}

/** One headline figure. Three of them across the top, in one row. */
function Figure({ value, label, strong }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        className={cn(
          'truncate font-slab text-[21px] leading-none font-medium tabular-nums',
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
  const compact = useStore((st) => st.compact)
  const [busy, setBusy] = useState(false)
  const offer = shouldOffer(use?.fraction)

  const run = async () => {
    setBusy(true)
    await compact(s.id)
    setBusy(false)
  }

  return (
    <li className="flex items-center gap-[9px]">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: PROVIDER_ACCENT[s.provider] }}
      />
      <span className="w-[82px] shrink-0 truncate font-mono text-[10px] text-fg-muted" title={s.name}>
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
      {/* The offer sits on the meter that raised it: a full window is the only
          moment this is the obvious next move, and a button parked somewhere
          else is one you find after the run has already failed. */}
      {offer && (
        <button
          onClick={() => void run()}
          disabled={busy}
          title="Have this agent write a handover note, then continue in a fresh window carrying only that note"
          className="shrink-0 rounded px-1.5 py-px font-mono text-[9px] text-[var(--color-attn)] hover:bg-surface-2 disabled:text-fg-faint"
        >
          {busy ? 'compacting…' : 'compact'}
        </button>
      )}
      <span
        className={cn(
          'w-7 shrink-0 text-right font-mono text-[10px] tabular-nums',
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
  // Minimized still counts as open: the header badge is the plan window, and
  // it is the reason to leave the panel folded in the corner at all.
  const open = useStore((s) => s.panels.usage.open)
  const plan = usePlan(open)
  // The two headline windows, which is what the CLI's own view leads with. A
  // scoped or unreleased bucket at 0% is noise at the top of a panel; it is
  // still drawn in the list below.
  const headline = (plan?.windows ?? []).filter((w) => w.kind !== 'weekly_scoped').slice(0, 2)
  // Codex reports no cost at all — not zero, none — so a canvas with one on it
  // has a total that is knowingly short. Saying so beats a confident figure.
  const silent = sessions.some((s) => s.provider === 'codex')

  return (
    <FloatingPanel
      panel="usage"
      title="USAGE"
      Icon={Gauge}
      badge={
        // On a plan, the figure you keep an eye on is the window, not the
        // money — and a minimized Usage should still carry the one that can
        // stop a run. Money is the right badge only where money is charged.
        plan?.available && headline[0] ? (
          <span
            className={cn(
              'font-mono text-[9.5px] tabular-nums',
              BAND_TEXT[planBand(headline[0].percent)],
            )}
            title={`${headline[0].label} window${
              plan.subscription ? ` on your ${plan.subscription} plan` : ''
            }`}
          >
            {Math.round(headline[0].percent)}% {headline[0].label}
          </span>
        ) : (
          <span className="font-mono text-[9.5px] text-fg-subtle tabular-nums">
            {fmtUsd(total.costUsd)} this canvas
          </span>
        )
      }
    >
      {/* The headline is what you glance at: on a plan, the two windows that
          can stop the run; on API-key auth, the money, because there the money
          is real. Agents is in both — it is what the other two are spread
          over. */}
      <div className="flex gap-3.5 px-3.5 pt-3.5 pb-3">
        {plan?.available && headline.length > 0 ? (
          headline.map((w) => (
            <Figure
              key={w.kind}
              value={`${Math.round(w.percent)}%`}
              label={untilReset(w.resetsAt) ? `${w.label} · ${untilReset(w.resetsAt)}` : w.label}
              strong={w.kind === headline[0].kind}
            />
          ))
        ) : (
          <>
            <Figure value={fmtUsd(total.costUsd)} label="spent" strong />
            <Figure
              value={rate != null ? fmtUsd(rate) : '—'}
              label={rate != null ? 'per 10 min' : 'rate — too early'}
            />
          </>
        )}
        <Figure value={String(total.sessions)} label={total.sessions === 1 ? 'agent' : 'agents'} />
      </div>

      {/* About the account rather than this canvas, which is why it survives an
          empty one: whether there is room to start a squad is a question you
          ask before there are any agents to ask it about. */}
      {plan?.available && plan.windows.length > 0 && (
        <div className="flex flex-col gap-[9px] border-t border-line px-3.5 pt-3 pb-3.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">PLAN LIMITS</span>
            <span className="ml-auto font-mono text-[9px] text-fg-faint">
              {plan.subscription ? `${plan.subscription} · claude` : 'claude'}
            </span>
          </div>
          <ul className="space-y-[9px]">
            {plan.windows.map((w) => (
              <WindowRow key={w.kind + w.label} w={w} />
            ))}
          </ul>
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="border-t border-line px-3.5 py-4 text-[11px] leading-snug text-fg-faint">
          No agents on this canvas yet. Spawn one and its context window
          {plan?.available ? ' and share of the run' : ' and spend'} appear here.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-[9px] border-t border-line px-3.5 pt-3 pb-3.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">
                CONTEXT WINDOW
              </span>
              <span className="ml-auto font-mono text-[9px] text-fg-faint">
                the one that ends a run
              </span>
            </div>
            <ul className="max-h-32 space-y-[9px] overflow-y-auto overscroll-contain">
              {sessions.map((s) => (
                <ContextRow key={s.id} s={s} />
              ))}
            </ul>
          </div>

          {shares.length > 0 && (
            <div className="flex flex-col gap-2.5 border-t border-line px-3.5 pt-3 pb-3.5">
              {/* "Spend" is only true where money changes hands. On a plan
                  the same bar answers a different question — which agent used
                  the run up — so it is named for that instead. */}
              <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">
                {plan?.subscription ? 'SHARE OF THE RUN' : 'SPEND BY AGENT'}
              </span>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-sm">
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
                    {/* The swatch sits with the figure rather than above the
                        name: it is what ties this column to its slice of the
                        bar, and the bar is directly above it. */}
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-[5px] w-[5px] shrink-0 rounded-full"
                        style={{ background: PROVIDER_ACCENT[s.provider] }}
                      />
                      <span className="font-mono text-[10.5px] text-fg tabular-nums">
                        {fmtUsd(s.costUsd)}
                      </span>
                    </span>
                    <span className="truncate font-mono text-[8px] text-fg-faint">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-line bg-panel px-3.5 py-2 font-mono text-[9.5px] text-fg-faint tabular-nums">
            <CircleDot
              size={11}
              className="shrink-0"
              style={{ color: rate != null ? 'var(--color-live)' : 'var(--color-fg-faint)' }}
            />
            {/* What the money means depends on how you pay. On a plan these
                turns are already covered by the monthly fee, so the figure is
                what they would have cost at API rates — a way to compare
                agents against each other, not a bill. Saying "spent" there
                would be the panel's one outright lie. */}
            <span
              className="truncate"
              title={
                (plan?.subscription
                  ? `Your ${plan.subscription} plan covers these turns. This is what the tokens would cost at API rates, for comparison only.`
                  : 'Billed per token on this login.') +
                `\nin ${fmtTokens(total.inputTokens)} · out ${fmtTokens(total.outputTokens)}` +
                (silent ? '\ncodex reports no cost, so it is missing from this figure.' : '')
              }
            >
              {plan?.subscription
                ? `≈ ${fmtUsd(total.costUsd)} at API rates`
                : rate != null
                  ? `≈ ${fmtUsd(rate * 6)}/hr at this pace`
                  : 'rate — too early to say'}
              {silent && ', codex not counted'}
            </span>
            {/* The agent nearest its ceiling is the one that will fail first,
                and the reason to look at this panel before starting something
                long. */}
            {total.tightest?.use.fraction != null && (
              <span
                className={cn(
                  'ml-auto shrink-0 truncate',
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
