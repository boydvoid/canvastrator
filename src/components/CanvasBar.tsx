import { useCallback, useEffect, useState } from 'react'
import { Check, CheckSquare, FilePlus2, FolderOpen, Save, Square, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { detectCheck, guardRules, type GuardRule } from '@/lib/bridge'
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  deleteCanvas,
  deleteCanvases,
  listSavedCanvases,
  newCanvas,
  openCanvas,
  renameCanvas,
  saveCanvas,
  saveCanvasAs,
} from '@/lib/canvas'
import type { CanvasMeta } from '@/lib/persist'
import { SHORTCUT_LABEL } from '@/lib/shortcuts'
import { useInViewRef, useStore } from '@/lib/store'
import { cn, timeAgo as when } from '@/lib/utils'

/** "Old" for the sweep in the open dialog: untouched for a month. */
const OLD_MS = 30 * 24 * 60 * 60 * 1000

/**
 * ⌘S saves. An unsaved canvas has nowhere to save to, so it asks for a name
 * first rather than inventing one.
 */
function saveOrPrompt() {
  if (useStore.getState().canvasId) void saveCanvas()
  else useStore.setState({ canvasDialog: 'save-as', canvasError: null })
}

/** The canvas menu section, for the right-click menu on the surface. */
export function CanvasMenuItems() {
  const canvasId = useStore((s) => s.canvasId)
  const setDialog = useStore((s) => s.setCanvasDialog)

  return (
    <>
      <ContextMenuLabel>Canvas</ContextMenuLabel>
      <ContextMenuItem onSelect={() => saveOrPrompt()} className="justify-between">
        Save
        <span className="font-mono text-[10px] text-fg-faint">⌘S</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => setDialog('save-as')} className="justify-between">
        {canvasId ? 'Save a copy…' : 'Save as…'}
        <span className="font-mono text-[10px] text-fg-faint">⇧⌘S</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => setDialog('open')} className="justify-between">
        Open…
        <span className="font-mono text-[10px] text-fg-faint">⌘O</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => newCanvas()} className="justify-between">
        New canvas
        <span className="font-mono text-[10px] text-fg-faint">⌘N</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => setDialog('rules')} className="justify-between">
        Global rules…
        <span className="font-mono text-[10px] text-fg-faint">{SHORTCUT_LABEL.rules}</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  )
}

/**
 * The switcher. Clicking the canvas name lists every saved canvas, so moving
 * between them is one click rather than a dialog. Rename lives here too — the
 * name is the thing you click, so it's where you'd look to change it.
 */
function CanvasSwitcher() {
  const name = useStore((s) => s.canvasName)
  const canvasId = useStore((s) => s.canvasId)
  const setDialog = useStore((s) => s.setCanvasDialog)

  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<CanvasMeta[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  // Refresh on open — another window or an agent may have added one.
  useEffect(() => {
    if (!open) return
    void listSavedCanvases().then(setSaved).catch(() => setSaved([]))
  }, [open])

  const commitRename = () => {
    setEditing(false)
    void renameCanvas(draft)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commitRename()
          if (e.key === 'Escape') {
            setDraft(name)
            setEditing(false)
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        spellCheck={false}
        size={Math.max(draft.length, 8)}
        className="pointer-events-auto rounded border border-line-strong bg-canvas px-1 font-mono text-[10.5px] text-fg outline-none"
      />
    )
  }

  const others = saved.filter((c) => c.id !== canvasId)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="pointer-events-auto -mx-1 rounded px-1 text-fg hover:bg-surface"
          title="Switch or rename canvas"
        >
          {name} <span className="text-fg-muted">▾</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="pointer-events-auto">
        <DropdownMenuLabel>Canvases</DropdownMenuLabel>

        {canvasId && (
          <DropdownMenuItem disabled className="justify-between !opacity-100">
            <span className="truncate text-fg">{name}</span>
            <Check size={11} className="shrink-0 text-[var(--color-live)]" />
          </DropdownMenuItem>
        )}

        {others.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() => void openCanvas(c.id)}
            className="justify-between"
          >
            <span className="truncate">{c.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-fg-faint">
              {c.nodes} node{c.nodes === 1 ? '' : 's'}
            </span>
          </DropdownMenuItem>
        ))}

        {!canvasId && !others.length && (
          <DropdownMenuItem disabled>No saved canvases yet</DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            setDraft(name)
            // The menu closes on select; wait for it before taking focus.
            setTimeout(() => setEditing(true), 0)
          }}
        >
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog('rules')}>Global rules…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog('save-as')}>Save a copy…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => newCanvas()} className="justify-between">
          New canvas
          <span className="font-mono text-[10px] text-fg-faint">⌘N</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Name + save state, for the top bar. */
export function CanvasStatus() {
  const canvasId = useStore((s) => s.canvasId)
  const dirty = useStore((s) => s.canvasDirty)
  const savedAt = useStore((s) => s.canvasSavedAt)
  const error = useStore((s) => s.canvasError)

  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px]">
      <CanvasSwitcher />
      {error ? (
        <span className="text-[var(--color-danger)]" title={error}>
          save failed
        </span>
      ) : !canvasId ? (
        <span className="text-fg-muted">not saved yet</span>
      ) : dirty ? (
        <span className="text-[var(--color-live)]">●</span>
      ) : savedAt ? (
        <span className="text-fg-muted">saved {when(savedAt)}</span>
      ) : null}
    </span>
  )
}

/** Open / Save-as / rules overlays, plus the shortcuts that raise them. */
export function CanvasDialogs() {
  const inView = useInViewRef()
  const dialog = useStore((s) => s.canvasDialog)
  const setDialog = useStore((s) => s.setCanvasDialog)
  const openFilePath = useStore((s) => s.openFilePath)

  useEffect(() => {
    // The file editor is modal and binds ⌘S itself; don't fight it.
    if (openFilePath) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        if (e.shiftKey) setDialog('save-as')
        else saveOrPrompt()
      } else if (key === 'o') {
        e.preventDefault()
        setDialog('open')
      } else if (key === 'n') {
        e.preventDefault()
        newCanvas()
      }
    }
    // Once per open canvas otherwise: ⌘N would start a canvas for every one
    // already on the desk, and ⌘S would save them all. See `useInView`.
    const guarded = (e: KeyboardEvent) => {
      if (inView.current) onKey(e)
    }
    document.addEventListener('keydown', guarded, true)
    return () => document.removeEventListener('keydown', guarded, true)
  }, [inView, setDialog, openFilePath])

  if (!dialog) return null
  return (
    <Shell onClose={() => setDialog(null)}>
      {dialog === 'open' ? <OpenPanel /> : dialog === 'rules' ? <RulesPanel /> : <SavePanel />}
    </Shell>
  )
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-canvas/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-[min(520px,90vw)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line-soft px-3 py-2">
      <span className="font-mono text-[12px] text-fg">{title}</span>
      <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} title="Close  Esc">
        <X size={13} />
      </Button>
    </header>
  )
}

function ErrorLine() {
  const error = useStore((s) => s.canvasError)
  if (!error) return null
  return (
    <div className="shrink-0 border-t border-line-soft bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-danger)]">
      {error}
    </div>
  )
}

/**
 * The canvas's global rules. Every keystroke goes straight to the store, which
 * is what marks the canvas dirty and lets autosave write it — there is no Save
 * button here because there is nothing a Save button would do that closing the
 * panel doesn't already.
 */
function RulesPanel() {
  const rules = useStore((s) => s.globalRules)
  const setRules = useStore((s) => s.setGlobalRules)
  const setDialog = useStore((s) => s.setCanvasDialog)
  const isolate = useStore((s) => s.isolateSpawns)
  const setIsolate = useStore((s) => s.setIsolateSpawns)
  const check = useStore((s) => s.checkCommand)
  const setCheck = useStore((s) => s.setCheckCommand)
  const guards = useStore((s) => s.guards)
  const setGuards = useStore((s) => s.setGuards)
  const [guardable, setGuardable] = useState<GuardRule[]>([])

  useEffect(() => {
    let live = true
    void guardRules()
      .then((r) => live && setGuardable(r))
      .catch(() => live && setGuardable([]))
    return () => {
      live = false
    }
  }, [])
  const cwd = useStore((s) => s.cwd)
  const [guess, setGuess] = useState<string | null>(null)

  // Offered, never applied: a wrong guess that ran on its own would be worse
  // than no guess, and the command is the one setting here that executes.
  useEffect(() => {
    let live = true
    if (check.trim() || !cwd) return
    void detectCheck(cwd)
      .then((g) => live && setGuess(g))
      .catch(() => live && setGuess(null))
    return () => {
      live = false
    }
  }, [check, cwd])

  return (
    <>
      <Header title="Canvas global rules" onClose={() => setDialog(null)} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="shrink-0 font-mono text-[10.5px] text-fg-subtle">
          Given to every agent spawned on this canvas, orchestrator included. Agents already
          running keep the rules they started with.
        </p>
        <textarea
          autoFocus
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          rows={12}
          placeholder="e.g. Never commit or push. Run the tests before reporting done."
          className="min-h-0 flex-1 resize-none rounded-md border border-line bg-canvas p-2 font-mono text-[11px] leading-relaxed text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
        />

        {/* A rule about where agents work, next to the rules about how they
            work — both are things this canvas imposes on every agent it
            spawns, and both only apply to the next one. */}
        <label className="flex shrink-0 cursor-pointer items-start gap-2 rounded-md border border-line bg-canvas p-2.5">
          <input
            type="checkbox"
            checked={isolate}
            onChange={(e) => setIsolate(e.target.checked)}
            className="mt-[3px] shrink-0 accent-[var(--color-live)]"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-[11px] text-fg">Give each new agent its own worktree</span>
            <span className="font-mono text-[10px] leading-relaxed text-fg-subtle">
              A git checkout per agent, on a <code>wt/</code> branch beside the repository, so a squad
              editing the same project cannot overwrite each other. Agents already on the canvas keep
              the folder they have.
            </span>
          </span>
        </label>

        {guardable.length > 0 && (
          <div className="flex shrink-0 flex-col gap-1.5 rounded-md border border-line bg-canvas p-2.5">
            <span className="font-mono text-[11px] text-fg">Ask before</span>
            <span className="font-mono text-[10px] leading-relaxed text-fg-subtle">
              Held back by the app itself, not by the provider's permission mode: the command never
              runs, and the agent is told to ask you. Allow one from the agent's inspector when it
              does.
            </span>
            {guardable.map((r) => {
              const on = guards.includes(r.id)
              return (
                <label key={r.id} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setGuards(
                        e.target.checked
                          ? [...guards, r.id]
                          : guards.filter((g) => g !== r.id),
                      )
                    }
                    className="shrink-0 accent-[var(--color-attn)]"
                  />
                  <span className="min-w-0 font-mono text-[10.5px] text-fg-muted">
                    <span className="text-fg">{r.id}</span> — {r.what}
                  </span>
                </label>
              )
            })}
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-1.5 rounded-md border border-line bg-canvas p-2.5">
          <span className="font-mono text-[11px] text-fg">Check command</span>
          <span className="font-mono text-[10px] leading-relaxed text-fg-subtle">
            Run in an agent's own folder after any turn that writes a file, and whenever you ask.
            A failing check turns its node red — the project's verdict, rather than the agent's.
          </span>
          <input
            value={check}
            onChange={(e) => setCheck(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            spellCheck={false}
            placeholder="nothing runs until you set one"
            className="rounded border border-line bg-panel px-2 py-1.5 font-mono text-[11px] text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
          />
          {guess && !check.trim() && (
            <button
              onClick={() => setCheck(guess)}
              className="self-start rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle hover:bg-surface hover:text-fg"
            >
              use <span className="text-fg-muted">{guess}</span>
            </button>
          )}
        </div>
      </div>
      <ErrorLine />
    </>
  )
}

function SavePanel() {
  const current = useStore((s) => s.canvasName)
  const canvasId = useStore((s) => s.canvasId)
  const setDialog = useStore((s) => s.setCanvasDialog)
  const [name, setName] = useState(current === 'untitled' ? '' : current)
  const [busy, setBusy] = useState(false)

  const commit = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    // An unsaved canvas is being named, not copied — keep writing to itself.
    const ok = canvasId ? await saveCanvasAs(trimmed) : await saveCanvas(trimmed)
    setBusy(false)
    if (ok) setDialog(null)
  }, [name, busy, canvasId, setDialog])

  return (
    <>
      <Header title={canvasId ? 'Save a copy' : 'Save canvas'} onClose={() => setDialog(null)} />
      <div className="flex items-center gap-2 p-3">
        <input
          autoFocus
          value={name}
          placeholder="canvas name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
          }}
          className="h-8 flex-1 rounded-md border border-line bg-canvas px-2.5 font-mono text-[12px] text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
        />
        <Button size="sm" onClick={() => void commit()} disabled={!name.trim() || busy}>
          <Save size={11} />
          {busy ? 'saving…' : 'Save'}
        </Button>
      </div>
      <ErrorLine />
    </>
  )
}

function OpenPanel() {
  const setDialog = useStore((s) => s.setCanvasDialog)
  const currentId = useStore((s) => s.canvasId)
  const dirty = useStore((s) => s.canvasDirty)
  const nodeCount = useStore((s) => s.nodes.length)
  const [list, setList] = useState<CanvasMeta[] | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirmSweep, setConfirmSweep] = useState(false)

  const refresh = useCallback(() => {
    listSavedCanvases()
      .then(setList)
      .catch((e: unknown) => {
        useStore.setState({ canvasError: String(e) })
        setList([])
      })
  }, [])

  useEffect(refresh, [refresh])

  // Opening replaces the graph; an unsaved one would be gone for good.
  const unsavedWork = nodeCount > 0 && (!currentId || dirty)

  const toggle = (id: string) => {
    setConfirmSweep(false)
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const stale = (list ?? []).filter((c) => Date.now() - c.updatedAt > OLD_MS)

  const sweep = () => {
    const ids = [...picked]
    setPicked(new Set())
    setConfirmSweep(false)
    void deleteCanvases(ids).then(refresh)
  }

  return (
    <>
      <Header title="Open canvas" onClose={() => setDialog(null)} />

      {unsavedWork && (
        <div className="shrink-0 border-b border-line-soft px-3 py-1.5 font-mono text-[10.5px] text-fg-subtle">
          This canvas has unsaved changes — opening another will discard them.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {list === null && <p className="p-4 font-mono text-[11px] text-fg-faint">loading…</p>}
        {list?.length === 0 && (
          <p className="p-4 font-mono text-[11px] text-fg-faint">
            No saved canvases yet — ⌘S saves this one.
          </p>
        )}
        {list?.map((c) => (
          <div
            key={c.id}
            className={cn(
              'group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface',
              c.id === currentId && 'bg-surface',
            )}
          >
            <button
              type="button"
              title={picked.has(c.id) ? 'Deselect' : 'Select for deletion'}
              onClick={() => toggle(c.id)}
              // Hidden until wanted: picking several is the rare path, and a
              // column of empty boxes would sit on top of the common one.
              className={cn(
                'shrink-0 text-fg-faint hover:text-fg-muted',
                picked.has(c.id)
                  ? 'text-[var(--color-danger)] hover:text-[var(--color-danger)]'
                  : 'opacity-0 group-hover:opacity-100',
              )}
            >
              {picked.has(c.id) ? <CheckSquare size={11} /> : <Square size={11} />}
            </button>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
              onClick={() => void openCanvas(c.id)}
            >
              <FolderOpen size={11} className="shrink-0 text-fg-faint" />
              <span className="truncate font-mono text-[12px] text-fg">{c.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">
                {c.nodes} node{c.nodes === 1 ? '' : 's'} · {when(c.updatedAt)}
              </span>
            </button>
            {confirmId === c.id ? (
              <Button
                variant="danger"
                size="xs"
                onClick={() => {
                  setConfirmId(null)
                  void deleteCanvas(c.id).then(refresh)
                }}
              >
                delete?
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100"
                title="Delete"
                onClick={() => setConfirmId(c.id)}
              >
                <Trash2 size={11} />
              </Button>
            )}
          </div>
        ))}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-line-soft px-3 py-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            newCanvas()
            setDialog(null)
          }}
        >
          <FilePlus2 size={11} /> New canvas
        </Button>

        {!picked.size && stale.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            title="Select every canvas untouched for a month"
            onClick={() => setPicked(new Set(stale.map((c) => c.id)))}
          >
            Select old ({stale.length})
          </Button>
        )}

        {picked.size > 0 && (
          <>
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto"
              onClick={() => {
                setPicked(new Set())
                setConfirmSweep(false)
              }}
            >
              Clear
            </Button>
            <Button
              variant="danger"
              size="xs"
              onClick={() => (confirmSweep ? sweep() : setConfirmSweep(true))}
            >
              <Trash2 size={11} />
              {confirmSweep
                ? `delete ${picked.size}?`
                : `Delete ${picked.size} selected`}
            </Button>
          </>
        )}
      </footer>
      <ErrorLine />
    </>
  )
}
