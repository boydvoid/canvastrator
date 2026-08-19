import { Sparkles, UserRoundPlus } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import { useStore } from '@/lib/store'
import { PROVIDER_ACCENT, type Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * An orchestrator's reply is part prose and part machinery. Rendered as plain
 * markdown, a `SPAWN` line and a persona definition read as noise the user is
 * supposed to ignore — worse, the definition dumps raw YAML into the chat.
 * They're actions, so they get rendered as actions.
 */

type Segment =
  | { kind: 'prose'; text: string }
  | { kind: 'spawn'; name: string; task: string }
  | { kind: 'persona'; name: string; fields: Record<string, string>; brief: string }

const SPAWN_LINE = /^[ \t]*(SPAWN|DELEGATE)[ \t]+([\w.-]+)[ \t]*:[ \t]*/i
const PERSONA_FENCE = /```canvastrator-persona\s*\n([\s\S]*?)```/gi

/**
 * Split a reply into prose and directives.
 *
 * The task on a `SPAWN` runs to the end of the reply or to the next directive,
 * matching how the store parses it — the card must show exactly what the child
 * was actually sent, not a prettier summary of it.
 */
export function splitAgentText(text: string): Segment[] {
  const out: Segment[] = []
  let rest = text

  // Persona definitions first: they're fenced, so their boundaries are exact.
  const fences: { start: number; end: number; seg: Segment }[] = []
  for (const m of rest.matchAll(PERSONA_FENCE)) {
    const body = m[1]
    const cut = body.search(/^\s*---\s*$/m)
    const head = cut === -1 ? body : body.slice(0, cut)
    const brief = cut === -1 ? '' : body.slice(cut).replace(/^\s*---\s*$/m, '').trim()
    const fields: Record<string, string> = {}
    for (const line of head.split('\n')) {
      const kv = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i)
      if (kv) fields[kv[1].toLowerCase()] = kv[2].trim()
    }
    if (fields.name) {
      fences.push({
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
        seg: { kind: 'persona', name: fields.name, fields, brief },
      })
    }
  }

  let cursor = 0
  const pushProse = (chunk: string) => {
    if (chunk.trim()) out.push({ kind: 'prose', text: chunk.trim() })
  }

  const emitWithSpawns = (chunk: string) => {
    const lines = chunk.split('\n')
    let buffer: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(SPAWN_LINE)
      if (!m) {
        buffer.push(lines[i])
        continue
      }
      pushProse(buffer.join('\n'))
      buffer = []
      // Everything after the directive belongs to it, until the next one.
      const first = lines[i].slice(m[0].length)
      const task: string[] = first ? [first] : []
      while (i + 1 < lines.length && !SPAWN_LINE.test(lines[i + 1])) {
        task.push(lines[++i])
      }
      out.push({ kind: 'spawn', name: m[2], task: task.join('\n').trim() })
    }
    pushProse(buffer.join('\n'))
  }

  for (const f of fences) {
    emitWithSpawns(rest.slice(cursor, f.start))
    out.push(f.seg)
    cursor = f.end
  }
  emitWithSpawns(rest.slice(cursor))

  return out
}

function SpawnCard({ name, task }: { name: string; task: string }) {
  // Link the card to the agent it produced, if that agent is still around.
  const target = useStore((s) =>
    s.nodes.find(
      (n) => n.type === 'session' && n.data.name.toLowerCase().startsWith(name.toLowerCase()),
    ),
  )
  const setChatTarget = useStore((s) => s.setChatTarget)
  const state = target && target.type === 'session' ? target.data.state : null
  const busy = state === 'thinking' || state === 'streaming'
  const accent =
    target && target.type === 'session' ? PROVIDER_ACCENT[target.data.provider] : undefined

  return (
    <div
      className={cn(
        'my-1.5 overflow-hidden rounded-lg border bg-surface/40',
        busy ? 'border-line-strong' : 'border-line',
      )}
      style={busy ? ({ '--accent': accent } as React.CSSProperties) : undefined}
    >
      <div className="flex items-center gap-1.5 border-b border-line-soft px-2 py-1">
        <UserRoundPlus size={11} className="shrink-0 text-fg-muted" style={{ color: accent }} />
        <span className="font-mono text-[10.5px] tracking-wide text-fg-muted uppercase">
          spawned
        </span>
        <button
          onClick={() => target && setChatTarget(target.id)}
          disabled={!target}
          className="truncate font-mono text-[11.5px] text-fg hover:underline disabled:no-underline"
          title={target ? 'Open this agent in the chat panel' : undefined}
        >
          {name}
        </button>
        {state && (
          <span
            className={cn(
              'ml-auto shrink-0 font-mono text-[10px]',
              busy ? 'text-fg' : 'text-fg-faint',
            )}
          >
            {busy && <span className="gt-caret mr-1">●</span>}
            {state}
          </span>
        )}
      </div>
      <p className="px-2 py-1.5 text-[11.5px] leading-snug whitespace-pre-wrap text-fg-muted">
        {task}
      </p>
    </div>
  )
}

function PersonaCard({
  name,
  fields,
  brief,
}: {
  name: string
  fields: Record<string, string>
  brief: string
}) {
  const chips = [fields.provider, fields.model, fields.effort, fields.permission].filter(Boolean)
  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-line bg-surface/40">
      <div className="flex items-center gap-1.5 border-b border-line-soft px-2 py-1">
        <Sparkles size={11} className="shrink-0 text-fg-muted" />
        <span className="font-mono text-[10.5px] tracking-wide text-fg-muted uppercase">
          new persona
        </span>
        <span className="truncate font-mono text-[11.5px] text-fg">{name}</span>
      </div>
      <div className="space-y-1 px-2 py-1.5">
        {fields.description && (
          <p className="text-[11.5px] leading-snug text-fg-muted">{fields.description}</p>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <span
                key={c}
                className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9.5px] text-fg-muted"
              >
                {c}
              </span>
            ))}
          </div>
        )}
        {brief && (
          <details className="group">
            <summary className="cursor-default font-mono text-[10px] text-fg-faint hover:text-fg-muted">
              brief
            </summary>
            <p className="mt-1 border-l border-line pl-2 text-[11px] leading-snug whitespace-pre-wrap text-fg-muted">
              {brief}
            </p>
          </details>
        )}
      </div>
    </div>
  )
}

export function AgentMessage({
  text,
  streaming,
  provider: _provider,
}: {
  text: string
  streaming?: boolean
  provider?: Provider
}) {
  const segments = splitAgentText(text)
  return (
    <div className="min-w-0">
      {segments.map((seg, i) => {
        if (seg.kind === 'spawn') return <SpawnCard key={i} name={seg.name} task={seg.task} />
        if (seg.kind === 'persona')
          return <PersonaCard key={i} name={seg.name} fields={seg.fields} brief={seg.brief} />
        return (
          <Markdown
            key={i}
            text={seg.text}
            // Only the tail of a reply is still arriving.
            streaming={streaming && i === segments.length - 1}
          />
        )
      })}
    </div>
  )
}
