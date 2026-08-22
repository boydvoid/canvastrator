import { useEffect, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Activity, CircleAlert } from 'lucide-react'
import { FloatingPanel } from '@/components/panels/FloatingPanel'
import { lastSaid, questionTail } from '@/lib/asking'
import {
  checkTone,
  elapsed,
  KIND_LABEL,
  KIND_TONE,
  pulseNow,
  runSince,
  stateBar,
  toneColor,
  type PulseNow,
} from '@/lib/pulse'
import { useStore, type GtNode } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Notification } from '@/lib/types'

/** Redraw the elapsed column while anything is running, and not otherwise. */
function useTick(live: boolean) {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live])
}

/**
 * The three counts, as a row you read left to right.
 *
 * This was one sentence — "3 working · 1 needs you · 2 landed" — which reads
 * fine and scans badly: the numbers are the part you are looking for and they
 * were set in the same weight as the words between them. Each count now
 * carries the colour its segment takes in the bar underneath, so the bar needs
 * no legend of its own.
 */
function Counts({ now, since }: { now: PulseNow; since: number | null }) {
  const parts = [
    { n: now.working, label: 'working', tone: 'work' as const },
    { n: now.needsYou, label: 'needs you', tone: 'attn' as const },
    { n: now.failed, label: 'failed', tone: 'danger' as const },
    { n: now.landed, label: 'landed', tone: 'live' as const },
  ].filter((p) => p.n > 0)

  return (
    <div className="flex min-w-0 items-center gap-3.5">
      {parts.length === 0 ? (
        <span className="font-slab text-[15px] leading-none font-medium text-fg-muted">
          nothing running
        </span>
      ) : (
        parts.map((p) => (
          <span key={p.label} className="flex shrink-0 items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: toneColor(p.tone) }}
            />
            <span className="font-slab text-[17px] leading-none font-medium text-fg-strong tabular-nums">
              {p.n}
            </span>
            <span className="font-mono text-[10px] text-fg-subtle">{p.label}</span>
          </span>
        ))
      )}
      {since != null && (
        <span className="ml-auto shrink-0 font-mono text-[9px] text-fg-faint">
          {elapsed(since)} in
        </span>
      )}
    </div>
  )
}

/**
 * The one thing on the canvas that has stopped and is waiting for you.
 *
 * A question is the only state the canvas cannot get itself out of, and in a
 * feed of thirty entries it looked exactly like the twenty-nine that need
 * nothing. So it comes out of the feed and sits above it, in the only colour
 * this panel uses as a ground, with the button that answers it.
 */
function NeedsYou({ name, question, onGo }: { name: string; question: string; onGo: () => void }) {
  return (
    <div className="flex items-center gap-2.5 border-l-2 border-[var(--color-attn)] bg-[var(--color-attn-dim)] px-3.5 py-2.5">
      <CircleAlert size={12} className="shrink-0 text-[var(--color-attn)]" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-[10px] text-fg">{name} is waiting on you</span>
        <span className="line-clamp-2 font-mono text-[9px] leading-snug text-fg-faint">
          {question}
        </span>
      </span>
      <button
        onClick={onGo}
        className="shrink-0 rounded-md bg-[var(--color-attn)] px-2.5 py-[5px] font-mono text-[10px] text-canvas hover:brightness-110"
      >
        decide
      </button>
    </div>
  )
}

function Entry({ event, onGo }: { event: Notification; onGo: () => void }) {
  // A check is the one kind whose colour is its content: passing and failing
  // are the same event and opposite news.
  const tone = event.kind === 'check' ? checkTone(event.headline) : KIND_TONE[event.kind]
  const color = toneColor(tone, event.provider)
  return (
    <button
      onClick={onGo}
      className="flex w-full min-w-0 items-start gap-2.5 border-b border-line-soft px-3.5 py-2.5 text-left last:border-b-0 hover:bg-surface-2"
    >
      <span className="w-[34px] shrink-0 pt-[3px] text-right font-mono text-[9px] text-fg-faint tabular-nums">
        {elapsed(event.ts)}
      </span>
      <span
        className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[10px]" style={{ color }}>
            {event.sessionName}
          </span>
          <span className="shrink-0 rounded bg-surface-3 px-1 py-px font-mono text-[8px] text-fg-subtle">
            {KIND_LABEL[event.kind]}
          </span>
        </span>
        <span className="line-clamp-2 text-[11px] leading-[1.4] text-fg-muted">
          {event.headline}
        </span>
      </span>
    </button>
  )
}

/**
 * What the canvas is doing, one line per thing that happened.
 *
 * A node says what *it* is doing; nothing said what the canvas was doing. On a
 * squad of six, the questions that actually come up — who asked me something
 * two minutes ago, which agent finished, who wrote that file — could only be
 * answered by opening agents one at a time and reconstructing an order from
 * nothing, which is precisely the work the canvas exists to have already done.
 *
 * Two halves, deliberately computed from different things. The sentence at the
 * top is the present, read off live session state. The feed below is the past,
 * read off the log — see `pulse.ts` for why a record of events cannot answer
 * the first question.
 *
 * Clicking an entry flies the viewport to the node it happened on, which is
 * what makes this navigation rather than a report. That is also why it floats
 * rather than sitting on the canvas: a log you navigate *from* has to stay put
 * while the canvas moves under it.
 */
export function PulsePanel() {
  const feed = useStore((s) => s.notifications)
  const nodes = useStore((s) => s.nodes)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const { fitView } = useReactFlow()

  const sessions = nodes.filter((n): n is GtNode & { type: 'session' } => n.type === 'session')
  const now = pulseNow(
    sessions.map((n) => ({
      state: n.data.state,
      awaitingUser: n.data.awaitingUser,
      ran: n.data.messages.some((m) => m.role === 'assistant' && !!m.text),
    })),
  )
  const bar = stateBar(now)
  const since = runSince(feed)
  // The banner names one agent, not all of them: two questions at once is a
  // queue, and a queue belongs in Decisions where you can see the rest of it.
  const asking = sessions.find((n) => n.data.awaitingUser)
  useTick(now.working > 0)

  const go = (nodeId: string) => {
    // An event outlives the node it happened on — deleting an agent must not
    // rewrite history — so a click on an orphaned entry does nothing rather
    // than flying the viewport somewhere arbitrary.
    if (!nodes.some((n) => n.id === nodeId)) return
    setChatTarget(nodeId)
    void fitView({ nodes: [{ id: nodeId }], duration: 420, maxZoom: 1, padding: 0.4 })
  }

  return (
    <FloatingPanel
      panel="pulse"
      title="PULSE"
      Icon={Activity}
      badge={
        // Kept in the header so a minimized Pulse still answers the one
        // question you would unfold it for: is anything running.
        <span className="flex items-center gap-1.5 rounded-full bg-surface-3 px-2 py-0.5">
          <span
            className={cn('h-1 w-1 rounded-full', now.working > 0 && 'gt-caret')}
            style={{
              background: now.working > 0 ? 'var(--color-live)' : 'var(--color-fg-faint)',
            }}
          />
          <span className="font-mono text-[9px] text-fg-muted">
            {now.working > 0 ? 'live' : 'idle'}
          </span>
        </span>
      }
    >
      <div className="flex shrink-0 flex-col gap-2.5 px-3.5 pt-3 pb-3.5">
        <Counts now={now} since={since} />
        {bar && (
          <div className="flex h-[5px] gap-0.5 overflow-hidden rounded-sm">
            {bar.map((seg, i) => (
              <span
                key={i}
                className="h-full rounded-[2px]"
                style={{ width: `${seg.fraction * 100}%`, background: toneColor(seg.tone) }}
              />
            ))}
          </div>
        )}
      </div>

      {asking && (
        <NeedsYou
          name={asking.data.name}
          question={questionTail(lastSaid(asking.data.messages))}
          onGo={() => go(asking.id)}
        />
      )}

      <div className="max-h-64 overflow-y-auto overscroll-contain border-t border-line">
        {feed.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] leading-snug text-fg-faint">
            Nothing has happened yet. Prompts, shapes, turns and writes land here as they occur.
          </p>
        ) : (
          feed.map((e) => <Entry key={e.id} event={e} onGo={() => go(e.sessionNodeId)} />)
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3.5 py-2">
        <span className="font-mono text-[9px] text-fg-faint">click an entry to fly to its node</span>
      </div>
    </FloatingPanel>
  )
}
