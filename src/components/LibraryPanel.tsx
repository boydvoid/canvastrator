import { useState } from 'react'
import { Plus, Trash2, UserRoundCog } from 'lucide-react'
import { EffortField } from '@/components/EffortField'
import { ModelField } from '@/components/ModelField'
import { Button } from '@/components/ui/button'
import { newPersona, type Persona } from '@/lib/library'
import { useStore } from '@/lib/store'
import { PERMISSION_LABEL, PROVIDER_ACCENT, PROVIDER_LABEL, type Permission, type Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

const PROVIDERS: Provider[] = ['claude', 'codex', 'opencode']
const PERMISSIONS: Permission[] = ['plan', 'auto', 'full']

function Editor({
  persona,
  onChange,
  onDone,
}: {
  persona: Persona
  onChange: (p: Persona) => void
  onDone: () => void
}) {
  return (
    <div className="space-y-2 border-t border-line-soft bg-canvas/60 p-2.5">
      <input
        value={persona.name}
        onChange={(e) => onChange({ ...persona, name: e.target.value })}
        placeholder="name"
        className="w-full rounded border border-line bg-canvas px-1.5 py-1 font-mono text-[11.5px] text-fg outline-none focus:border-line-strong"
      />
      <textarea
        value={persona.description}
        onChange={(e) => onChange({ ...persona, description: e.target.value })}
        rows={2}
        placeholder="When the orchestrator should use this"
        className="w-full resize-none rounded border border-line bg-canvas px-1.5 py-1 text-[11.5px] text-fg-muted outline-none focus:border-line-strong"
        title="This is what the orchestrator reads when routing — be specific."
      />

      <input
        value={persona.model ?? ''}
        onChange={(e) => onChange({ ...persona, model: e.target.value || undefined })}
        placeholder="model — blank for the provider default"
        className="w-full rounded border border-line bg-canvas px-1.5 py-1 font-mono text-[10.5px] text-fg-subtle outline-none placeholder:text-fg-faint focus:border-line-strong"
      />

      <div className="flex flex-wrap gap-1">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            onClick={() => onChange({ ...persona, provider: p })}
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px]',
              persona.provider === p ? 'text-fg' : 'text-fg-subtle hover:bg-surface',
            )}
            style={
              persona.provider === p
                ? { background: `color-mix(in oklch, ${PROVIDER_ACCENT[p]} 20%, transparent)` }
                : undefined
            }
          >
            {PROVIDER_LABEL[p]}
          </button>
        ))}
        <span className="mx-0.5 w-px bg-surface-2" />
        {PERMISSIONS.map((p) => (
          <button
            key={p}
            onClick={() => onChange({ ...persona, permission: p })}
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px]',
              persona.permission === p
                ? p === 'full'
                  ? 'bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]'
                  : 'bg-surface-3 text-fg'
                : 'text-fg-subtle hover:bg-surface',
            )}
          >
            {PERMISSION_LABEL[p]}
          </button>
        ))}
      </div>

      <ModelField
        provider={persona.provider}
        value={persona.model}
        onChange={(model) => onChange({ ...persona, model })}
      />

      <EffortField value={persona.effort} onChange={(effort) => onChange({ ...persona, effort })} />

      <textarea
        value={persona.instructions}
        onChange={(e) => onChange({ ...persona, instructions: e.target.value })}
        rows={6}
        placeholder="Opening brief for every agent spawned from this persona…"
        className="w-full resize-none rounded border border-line bg-canvas p-1.5 font-mono text-[10.5px] leading-relaxed outline-none focus:border-line-strong"
      />

      <Button size="xs" onClick={onDone} className="w-full">
        Done
      </Button>
    </div>
  )
}

function Row({ persona, index }: { persona: Persona; index: number }) {
  const library = useStore((s) => s.library)
  const setLibrary = useStore((s) => s.setLibrary)
  const addSessionFromPersona = useStore((s) => s.addSessionFromPersona)
  const [editing, setEditing] = useState(false)

  const update = (p: Persona) => void setLibrary(library.map((x) => (x.id === p.id ? p : x)))
  const remove = () => void setLibrary(library.filter((x) => x.id !== persona.id))

  // Staggered so several started in a row don't stack.
  const place = () => addSessionFromPersona(persona, { x: 80 + index * 24, y: 120 + index * 24 })

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-start gap-2 p-2">
        <UserRoundCog
          size={12}
          className="mt-0.5 shrink-0"
          style={{ color: PROVIDER_ACCENT[persona.provider] }}
        />
        <button
          onClick={() => setEditing((v) => !v)}
          className="min-w-0 flex-1 text-left"
          title="Edit this persona"
        >
          <div className="flex items-baseline gap-1.5">
            <span className="truncate font-mono text-[11.5px] text-fg">{persona.name}</span>
            <span className="shrink-0 font-mono text-[9.5px] text-fg-faint">
              {persona.model ?? persona.provider}
            </span>
          </div>
          <div className="line-clamp-2 text-[11px] leading-snug text-fg-subtle">
            {persona.description}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-fg-faint">
            {PROVIDER_LABEL[persona.provider]}
            {persona.model ? ` · ${persona.model}` : ''}
            {persona.effort ? ` · ${persona.effort}` : ''}
          </div>
        </button>
        <div className="flex shrink-0 flex-col gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={place}
            title="Start an agent with this persona"
            className="h-5 w-5"
          >
            <Plus size={11} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={remove}
            title="Delete from library"
            className="h-5 w-5"
          >
            <Trash2 size={10} />
          </Button>
        </div>
      </div>

      {editing && <Editor persona={persona} onChange={update} onDone={() => setEditing(false)} />}
    </div>
  )
}

/**
 * The persona list. The dock owns the chrome; this owns the rows.
 */
export function LibraryContent() {
  const library = useStore((s) => s.library)
  const setLibrary = useStore((s) => s.setLibrary)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft px-2.5 py-1.5">
        <span className="font-mono text-[10px] text-fg-faint">{library.length} personas</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          onClick={() => void setLibrary([...library, newPersona()])}
          title="New persona"
        >
          <Plus size={12} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {library.length === 0 && (
          <p className="px-1 py-6 text-center font-mono text-[10.5px] text-fg-faint">
            no personas yet
          </p>
        )}
        {library.map((p, i) => (
          <Row key={p.id} persona={p} index={i} />
        ))}
      </div>

      <footer className="shrink-0 border-t border-line-soft px-2.5 py-1.5 font-mono text-[9.5px] leading-snug text-fg-faint">
        Every orchestrator can spawn these. Spawning one adds its node to the canvas.
      </footer>
    </div>
  )
}
