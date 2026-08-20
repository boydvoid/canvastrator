import { Compass, CornerDownRight, MessageSquare, TriangleAlert, UserPlus } from 'lucide-react'
import { decisionsFor, type Decision } from '@/lib/decisions'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

const STATE_TONE = {
  pending: 'text-fg-faint',
  running: 'text-fg',
  done: 'text-[var(--color-live)]',
  failed: 'text-[var(--color-danger)]',
} as const

function Entry({ d }: { d: Decision }) {
  switch (d.kind) {
    case 'ask':
      return (
        <li className="pt-2.5 first:pt-0">
          <p className="font-mono text-[11px] leading-relaxed text-fg">{d.text}</p>
        </li>
      )

    case 'shape':
      return (
        <li className="flex gap-1.5 pl-1">
          <Compass size={11} className="mt-[3px] shrink-0 text-fg-muted" />
          <p className="min-w-0 font-mono text-[10.5px] leading-relaxed text-fg-muted">
            <span className="text-fg">{d.label}</span>
            {d.why && <span className="text-fg-subtle"> — {d.why}</span>}
          </p>
        </li>
      )

    case 'step':
      return (
        <li className="flex gap-1.5 pl-1">
          <CornerDownRight size={11} className="mt-[3px] shrink-0 text-fg-faint" />
          <p className="min-w-0 font-mono text-[10.5px] leading-relaxed">
            <span className={cn('text-fg-muted', d.state && STATE_TONE[d.state])}>
              {d.persona}
            </span>
            <span className="text-fg-subtle"> {d.task}</span>
            {d.state && d.state !== 'pending' && (
              <span className={cn('ml-1', STATE_TONE[d.state])}>· {d.state}</span>
            )}
          </p>
        </li>
      )

    case 'persona':
      return (
        <li className="flex gap-1.5 pl-1">
          <UserPlus size={11} className="mt-[3px] shrink-0 text-fg-faint" />
          <p className="min-w-0 font-mono text-[10.5px] leading-relaxed text-fg-muted">
            invented <span className="text-fg">{d.name}</span>
            <span className="text-fg-subtle"> — {d.description}</span>
          </p>
        </li>
      )

    case 'note':
      return (
        <li className="flex gap-1.5 pl-1">
          <TriangleAlert size={11} className="mt-[3px] shrink-0 text-[var(--color-danger)]" />
          <p className="min-w-0 font-mono text-[10.5px] leading-relaxed text-fg-muted">{d.text}</p>
        </li>
      )

    case 'answer':
      return (
        <li className="flex gap-1.5 pl-1">
          <MessageSquare size={11} className="mt-[3px] shrink-0 text-fg-faint" />
          <p className="min-w-0 font-mono text-[10.5px] leading-relaxed text-fg-subtle">{d.text}</p>
        </li>
      )
  }
}

/**
 * Why the canvas looks the way it does.
 *
 * The canvas shows what happened; this shows what was decided, in order: what
 * was asked, the shape it chose and the reason it gave, every step it
 * proposed, the roles it invented, and every time the app pushed back. When an
 * answer comes back wrong, the mistake is nearly always one of these lines —
 * and in the transcript it is three screens up, between two paragraphs of
 * prose.
 *
 * It follows the orchestrator rather than the selected agent. A worker's
 * conversation is the work; the decisions are made here.
 */
export function DecisionContent() {
  const nodes = useStore((s) => s.nodes)
  const plan = useStore((s) => s.plan)
  const target = useStore((s) => s.chatTarget)
  const setChatTarget = useStore((s) => s.setChatTarget)

  const sessions = nodes.filter((n) => n.type === 'session')
  // The one being talked to when that is an orchestrator, so a canvas with
  // several of them follows the conversation rather than picking the oldest.
  const picked = sessions.find((n) => n.id === target && n.data.role === 'orchestrator')
  const orchestrator = picked ?? sessions.find((n) => n.data.role === 'orchestrator')

  if (!orchestrator) {
    return (
      <p className="px-3 py-4 font-mono text-[10.5px] leading-relaxed text-fg-faint">
        No orchestrator on this canvas yet. Its decisions — the shape it picks for a job, the
        steps it proposes, the roles it invents — appear here as it makes them.
      </p>
    )
  }

  const entries = decisionsFor(orchestrator.data.messages, plan)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
      <button
        onClick={() => setChatTarget(orchestrator.id)}
        className="mb-1.5 flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-surface"
        title="Open this agent in the chat"
      >
        <span className="truncate font-mono text-[11px] text-fg">{orchestrator.data.name}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">
          {entries.length} decision{entries.length === 1 ? '' : 's'}
        </span>
      </button>

      {entries.length === 0 ? (
        <p className="px-1 py-3 font-mono text-[10.5px] leading-relaxed text-fg-faint">
          Nothing decided yet. Ask it for something.
        </p>
      ) : (
        <ol className="space-y-1">
          {entries.map((d) => (
            <Entry key={d.id} d={d} />
          ))}
        </ol>
      )}
    </div>
  )
}
