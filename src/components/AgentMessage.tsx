import { GitBranch, Layers, Repeat2, Signpost, Sparkles, UserRoundPlus, Workflow } from 'lucide-react'
import { useState } from 'react'
import { Markdown } from '@/components/Markdown'
import { splitAgentText } from '@/lib/patternline'
import type { PatternId } from '@/lib/patterns'
import { useStore } from '@/lib/store'
import { PROVIDER_ACCENT, type Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * An orchestrator's reply is part prose and part machinery. Rendered as plain
 * markdown, a `PATTERN` line, a `SPAWN` line and a persona definition all read
 * as noise the user is supposed to ignore — worse, the definition dumps raw
 * YAML into the chat and the shape it chose wraps as body text above the reply
 * it governs. They're decisions and actions, so they get rendered as such.
 *
 * The splitting is in `@/lib/patternline`, tested without a DOM. What's left
 * here is only how each piece looks.
 */

/**
 * The shape, drawn as one chip.
 *
 * Every part of it is derived from `src/lib/patterns.ts` and the palette — the
 * glyph and the accent carry the rung, so six replies in a scrollback are
 * distinguishable before a word of the rationale is read.
 */
const PATTERN_GLYPH: Record<PatternId, typeof Layers> = {
  single: Layers,
  chain: GitBranch,
  route: Signpost,
  parallel: Workflow,
  orchestrate: Sparkles,
  evaluate: Repeat2,
}

/**
 * Written out rather than built from the id: Tailwind drops a theme variable
 * nothing references, and `var(--color-pattern-${id})` is invisible to it — the
 * six accents fell out of the stylesheet and the badges rendered colourless.
 * The literal names are what keeps them in the build, and the `Record` is what
 * makes a seventh pattern a type error here instead of a blank chip.
 */
const PATTERN_ACCENT: Record<PatternId, string> = {
  single: 'var(--color-pattern-single)',
  chain: 'var(--color-pattern-chain)',
  route: 'var(--color-pattern-route)',
  parallel: 'var(--color-pattern-parallel)',
  orchestrate: 'var(--color-pattern-orchestrate)',
  evaluate: 'var(--color-pattern-evaluate)',
}

function PatternBadge({ id, label, why }: { id: PatternId; label: string; why: string }) {
  const Glyph = PATTERN_GLYPH[id]
  return (
    <div
      className="my-1.5 flex items-start gap-2 rounded-lg border border-line bg-surface/40 px-2 py-1.5"
      style={{ '--accent': PATTERN_ACCENT[id] } as React.CSSProperties}
      title={label}
    >
      <span
        className="mt-px flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[10.5px] tracking-wide uppercase"
        style={{
          color: 'var(--accent)',
          background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
          boxShadow: 'inset 0 0 0 1px color-mix(in oklch, var(--accent) 30%, transparent)',
        }}
      >
        <Glyph size={11} className="shrink-0" />
        {id}
      </span>
      <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-fg-muted">{why}</p>
    </div>
  )
}

/**
 * The brief the child was sent, clamped until asked for.
 *
 * A spawn task runs to the end of the reply and is routinely several
 * paragraphs — printed in full it buries the conversation it sits in, and the
 * user scrolls past the orchestrator's own words to reach the next turn. Two
 * lines is enough to recognise which agent this is; the rest is there when the
 * question is what exactly it was told.
 */
function SpawnTask({ task }: { task: string }) {
  const [open, setOpen] = useState(false)
  // Cheap and deliberate: the clamp is the real test, and this only decides
  // whether to offer the control. A task that fits in two lines never does.
  const long = task.length > 140 || task.split('\n').length > 2

  return (
    <div className="px-2 py-1.5">
      <p
        className={cn(
          'text-[11.5px] leading-snug whitespace-pre-wrap text-fg-muted',
          long && !open && 'line-clamp-2',
        )}
      >
        {task}
      </p>
      {long && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-1 font-mono text-[10px] text-fg-faint hover:text-fg-muted"
        >
          {open ? '▴ less' : '▾ full task'}
        </button>
      )}
    </div>
  )
}

function SpawnCard({ name, task }: { name: string; task: string }) {
  // Link the card to the agent it produced, if that agent is still around.
  //
  // The card is built from the reply text, so it renders whether or not the
  // spawn actually succeeded. When no agent by this name exists it has to say
  // so: claiming to have started an agent that was never created sent the user
  // looking for a node that isn't on the canvas.
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
        <span
          className="font-mono text-[10.5px] tracking-wide text-fg-muted uppercase"
          title={target ? undefined : 'No agent by this name is on the canvas'}
        >
          {target ? 'spawned' : 'spawn failed'}
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
      <SpawnTask task={task} />
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
        if (seg.kind === 'pattern')
          return <PatternBadge key={i} id={seg.id} label={seg.label} why={seg.why} />
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
