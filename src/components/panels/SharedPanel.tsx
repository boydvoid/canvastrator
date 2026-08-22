import { useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Radio, Trash2 } from 'lucide-react'
import { FloatingPanel } from '@/components/panels/FloatingPanel'
import { timeAgo } from '@/lib/ago'
import { board, readCount, search as searchEntries } from '@/lib/sharedcontext'
import { useStore, type GtNode } from '@/lib/store'
import { PROVIDER_ACCENT, type ContextEntry, type Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * One note, with the two things that decide whether it still matters: who said
 * it, and how much of the canvas has been told.
 */
function Note({
  entry,
  provider,
  read,
  of,
  onGo,
  onDrop,
}: {
  entry: ContextEntry
  provider?: Provider
  read: number
  of: number
  onGo: () => void
  onDrop: () => void
}) {
  return (
    <div className="group flex flex-col gap-1 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 hover:bg-surface-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <button
          onClick={onGo}
          className="shrink-0 truncate font-mono text-[10px] hover:underline"
          style={{ color: provider ? PROVIDER_ACCENT[provider] : 'var(--color-fg-subtle)' }}
          title={provider ? 'Open this agent in the chat' : 'Written by you'}
        >
          {entry.sessionName}
        </button>
        {entry.kind !== 'summary' && (
          <span
            className={cn(
              'shrink-0 rounded px-1 py-px font-mono text-[8px]',
              entry.kind === 'error'
                ? 'bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]'
                : 'bg-surface-3 text-fg-subtle',
            )}
          >
            {entry.kind === 'user' ? 'note' : entry.kind}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[9px] text-fg-faint tabular-nums">
          {timeAgo(entry.ts)}
        </span>
        {/* Only on hover: taking something off the board is rare, and a row of
            bins down the side reads as an invitation to tidy. */}
        <button
          onClick={onDrop}
          title="Take this off the board. Agents already given it keep it."
          className="shrink-0 rounded p-0.5 text-transparent group-hover:text-fg-subtle hover:bg-surface hover:!text-[var(--color-danger)]"
        >
          <Trash2 size={11} />
        </button>
      </span>
      <p className="text-[11px] leading-snug text-fg-muted">{entry.body}</p>
      <span className="font-mono text-[9px] text-fg-faint">
        {of === 0
          ? 'no one else to tell'
          : read === of
            ? `every agent has this`
            : `${read} of ${of} agents have this`}
      </span>
    </div>
  )
}

/**
 * What the whole canvas knows, in one place.
 *
 * Every agent reads this board on every turn — nothing is wired, nothing has
 * to be connected, and an agent spawned an hour from now still gets what was
 * learned this morning. That makes the board the one piece of state on the
 * canvas with no position and no edges, which is exactly why it needs a panel:
 * a thing that reaches everything cannot be represented by a line to anything.
 *
 * Entries arrive when an agent finishes a turn, and you can add one yourself —
 * the fact everyone needs is as often yours as an agent's. The count under each
 * one is the board's own readout: an entry every agent has read is settled, and
 * one nobody has read yet is about to change what four agents do next.
 */
export function SharedPanel() {
  const bus = useStore((s) => s.bus)
  const nodes = useStore((s) => s.nodes)
  const delivered = useStore((s) => s.delivered)
  const post = useStore((s) => s.postNote)
  const drop = useStore((s) => s.removeNote)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const { fitView } = useReactFlow()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  const sessions = useMemo(
    () => nodes.filter((n): n is GtNode & { type: 'session' } => n.type === 'session'),
    [nodes],
  )
  const shown = useMemo(() => searchEntries(board(bus), query), [bus, query])

  const go = (sessionId: string) => {
    const from = sessions.find((n) => n.data.sessionId === sessionId)
    if (!from) return
    setChatTarget(from.id)
    void fitView({ nodes: [{ id: from.id }], duration: 420, maxZoom: 1, padding: 0.4 })
  }

  return (
    <FloatingPanel
      panel="shared"
      title="SHARED"
      Icon={Radio}
      badge={
        <span className="font-mono text-[9.5px] text-fg-subtle tabular-nums">
          {bus.length} note{bus.length === 1 ? '' : 's'}
        </span>
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3.5 py-[9px]">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              post(draft)
              setDraft('')
            }
          }}
          placeholder="tell every agent something…"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[10.5px] text-fg outline-none placeholder:text-fg-faint"
        />
        {draft.trim() && <span className="shrink-0 font-mono text-[9px] text-fg-faint">⏎</span>}
      </div>

      {bus.length > 6 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-[7px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="filter…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
      )}

      <div className="max-h-72 overflow-y-auto overscroll-contain">
        {shown.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[11px] leading-snug text-fg-faint">
            {bus.length === 0
              ? 'Nothing shared yet. What each agent reports at the end of a turn lands here, and every other agent reads it on their next.'
              : 'Nothing matches that.'}
          </p>
        ) : (
          shown.map((e) => {
            const { read, of } = readCount(e, sessions.map((n) => n.data), delivered)
            const provider = sessions.find((n) => n.data.sessionId === e.sessionId)?.data.provider
            return (
              <Note
                key={e.id}
                entry={e}
                provider={provider}
                read={read}
                of={of}
                onGo={() => go(e.sessionId)}
                onDrop={() => drop(e.id)}
              />
            )
          })
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3.5 py-2">
        <span className="truncate font-mono text-[9px] text-fg-faint">
          every agent reads this — no wiring
        </span>
        <span className="ml-auto shrink-0 font-mono text-[9px] text-fg-subtle tabular-nums">
          {sessions.length} agent{sessions.length === 1 ? '' : 's'}
        </span>
      </div>
    </FloatingPanel>
  )
}
