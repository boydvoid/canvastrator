import { useReactFlow } from '@xyflow/react'
import { CornerUpLeft, GitFork, MessageSquare, Pause } from 'lucide-react'
import { FloatingPanel } from '@/components/panels/FloatingPanel'
import { lastSaid, questionTail } from '@/lib/asking'
import { choicesFrom, type Choice } from '@/lib/choices'
import { elapsed } from '@/lib/pulse'
import { useStore, type GtNode } from '@/lib/store'
import { PROVIDER_ACCENT } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The lines above the question: what the agent found, in its own words. */
function contextOf(said: string, question: string): string {
  const lines = said
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const body = lines.filter((l) => l.replace(/[*_`]/g, '').trim() !== question)
  // Prose only: the enumerated options are already drawn as the rows below,
  // and printing them twice makes the panel look like it is stuttering.
  return body
    .filter((l) => !/^\s*(?:[-*+]|\d+[.)])\s+/.test(l))
    .join(' ')
    .replace(/[*_`]/g, '')
    .trim()
}

/**
 * One way out of the question, as a row you can click.
 *
 * The first row is the one ⏎ takes, which is why it carries the marker and the
 * lit ground: an agent's first option is the one it is recommending, and a
 * panel that made you read all three before it told you which was the default
 * would be asking you to do the agent's work again.
 */
function Option({
  choice,
  first,
  onPick,
}: {
  choice: Choice
  first: boolean
  onPick: () => void
}) {
  return (
    <button
      onClick={onPick}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 border-b border-line-soft px-3.5 py-2.5 text-left last:border-b-0 hover:bg-surface-2',
        first && 'bg-surface-2',
      )}
    >
      <CornerUpLeft
        size={12}
        className={cn('shrink-0', first ? 'text-[var(--color-live)]' : 'text-fg-muted')}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-[11px] text-fg">{choice.label}</span>
        {choice.note && (
          <span className="line-clamp-1 font-mono text-[9px] text-fg-faint">{choice.note}</span>
        )}
      </span>
      {first && <span className="shrink-0 font-mono text-[10px] text-fg-faint">⏎</span>}
    </button>
  )
}

/**
 * The question the canvas has stopped on, and the ways out of it.
 *
 * An agent that stops to ask something is the one state the canvas cannot get
 * itself out of, and it looked exactly like a finished turn: same idle pill,
 * same place in the feed, nothing saying the run was holding. Pulse now says
 * *that* it is waiting; this says what it asked and answers it.
 *
 * The options are read out of the agent's own words — see `choices.ts` — so a
 * click sends the option back as the reply you would have typed. When nothing
 * parses into a menu, the panel says so and hands you the chat rather than
 * inventing choices the agent never offered.
 *
 * It shows one question at a time, oldest first. A queue of three is still a
 * queue you answer one at a time, and stacking them would make the panel as
 * long as the feed it is supposed to interrupt.
 */
export function DecisionsPanel() {
  const nodes = useStore((s) => s.nodes)
  const feed = useStore((s) => s.notifications)
  const send = useStore((s) => s.send)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const setRightTab = useStore((s) => s.setRightTab)
  const { fitView } = useReactFlow()

  const waiting = nodes.filter(
    (n): n is GtNode & { type: 'session' } => n.type === 'session' && n.data.awaitingUser === true,
  )
  const asking = waiting[0]
  const said = asking ? lastSaid(asking.data.messages) : ''
  const question = questionTail(said)
  const context = contextOf(said, question)
  const choices = choicesFrom(said)
  // No timestamp on a message, so the ask is dated by the event that recorded
  // it — the same clock the feed above is counting in.
  const askedAt = asking
    ? feed.find((e) => e.sessionNodeId === asking.id && e.kind === 'question')?.ts
    : undefined

  const open = (id: string) => {
    setChatTarget(id)
    void fitView({ nodes: [{ id }], duration: 420, maxZoom: 1, padding: 0.4 })
  }

  return (
    <FloatingPanel
      panel="decisions"
      title="DECISIONS"
      Icon={GitFork}
      badge={
        waiting.length > 0 ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-attn-dim)] px-2 py-0.5">
            <span className="h-1 w-1 rounded-full bg-[var(--color-attn)]" />
            <span className="font-mono text-[9px] text-[var(--color-attn)]">
              {waiting.length} waiting
            </span>
          </span>
        ) : (
          <span className="font-mono text-[9.5px] text-fg-subtle">nothing waiting</span>
        )
      }
    >
      {!asking ? (
        <p className="px-3.5 py-4 text-[11px] leading-snug text-fg-faint">
          Nothing is waiting on you. When an agent stops to ask something, the question and the
          answers it offered appear here.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 px-3.5 pt-3 pb-3.5">
            <div className="flex min-w-0 items-center gap-[7px]">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: PROVIDER_ACCENT[asking.data.provider] }}
              />
              <button
                onClick={() => open(asking.id)}
                className="truncate font-mono text-[10px] text-fg-muted hover:text-fg"
                title="Open this agent in the chat"
              >
                {asking.data.name}
              </button>
              <span className="shrink-0 font-mono text-[9px] text-fg-faint">blocked</span>
              {askedAt != null && (
                <span className="ml-auto shrink-0 font-mono text-[9px] text-fg-faint">
                  asked {elapsed(askedAt)} ago
                </span>
              )}
            </div>
            <p className="font-slab text-[15px] leading-snug font-medium text-fg-strong">
              {question || 'It stopped without saying what it needs.'}
            </p>
            {context && (
              <p className="line-clamp-3 font-mono text-[10px] leading-relaxed text-fg-subtle">
                {context}
              </p>
            )}
          </div>

          {choices.length > 0 ? (
            <div className="flex flex-col border-t border-line">
              {choices.map((c, i) => (
                <Option
                  key={c.label}
                  choice={c}
                  first={i === 0}
                  onPick={() => void send(asking.id, c.label)}
                />
              ))}
            </div>
          ) : (
            <button
              onClick={() => open(asking.id)}
              className="flex w-full items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-left hover:bg-surface-2"
            >
              <MessageSquare size={12} className="shrink-0 text-fg-muted" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-mono text-[11px] text-fg">answer it</span>
                <span className="truncate font-mono text-[9px] text-fg-faint">
                  it offered no options — open the chat and say
                </span>
              </span>
            </button>
          )}

          <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3.5 py-2">
            <Pause size={11} className="shrink-0 text-fg-faint" />
            <span className="truncate font-mono text-[9px] text-fg-faint">
              holds the run until you answer
            </span>
            <button
              onClick={() => setRightTab('rationale')}
              className="ml-auto shrink-0 font-mono text-[9px] text-fg-subtle hover:text-fg-muted"
            >
              past calls
            </button>
          </div>
        </>
      )}
    </FloatingPanel>
  )
}
