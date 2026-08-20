import { useCallback, useEffect, useState } from 'react'
import { FilePlus2, Layers, PanelLeftClose, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  deleteCanvas,
  listSavedCanvases,
  newCanvas,
  openCanvas,
  renameCanvas,
} from '@/lib/canvas'
import type { CanvasMeta } from '@/lib/persist'
import { useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'

function Row({
  canvas,
  current,
  dirty,
  onDeleted,
  guard,
}: {
  canvas: CanvasMeta
  current: boolean
  dirty: boolean
  onDeleted: () => void
  /** True when opening another canvas would throw away unsaved work. */
  guard: boolean
}) {
  const [confirm, setConfirm] = useState<'open' | 'delete' | null>(null)
  const [draft, setDraft] = useState<string | null>(null)

  const open = () => {
    if (current) return
    if (guard && confirm !== 'open') return setConfirm('open')
    setConfirm(null)
    void openCanvas(canvas.id)
  }

  const commitRename = () => {
    const next = draft
    setDraft(null)
    if (next !== null) void renameCanvas(next)
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1 transition-colors',
        current ? 'bg-veil-strong' : 'hover:bg-veil-soft',
      )}
    >
      {draft !== null ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setDraft(null)
          }}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-line-strong bg-canvas px-1 text-[12px] text-fg outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={open}
          // Only the open canvas can be renamed: renaming writes the file it
          // belongs to, and that's the one we have in memory.
          onDoubleClick={() => current && setDraft(canvas.name)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={current ? 'Double-click to rename' : 'Open'}
        >
          <Layers size={11} className={cn('shrink-0', current ? 'text-fg-muted' : 'text-fg-faint')} />
          <span className={cn('truncate text-[12px]', current ? 'text-fg' : 'text-fg-muted')}>
            {confirm === 'open' ? 'discard unsaved work?' : canvas.name}
          </span>
          {current && dirty && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-live)]"
              title="unsaved changes"
            />
          )}
        </button>
      )}

      {/* The count gives way to delete on hover — same corner, and you're not
          reading node counts while reaching for the bin. */}
      <span className="shrink-0 font-mono text-[10px] text-fg-faint group-hover:hidden">
        {canvas.nodes}
      </span>
      <span className="hidden shrink-0 group-hover:block">
        {confirm === 'delete' ? (
          <Button
            variant="danger"
            size="xs"
            className="h-5 px-1.5"
            onClick={() => {
              setConfirm(null)
              void deleteCanvas(canvas.id).then(onDeleted)
            }}
          >
            delete?
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            title="Delete canvas"
            onClick={() => setConfirm('delete')}
          >
            <Trash2 size={11} />
          </Button>
        )}
      </span>
    </div>
  )
}

/**
 * Saved canvases, always on screen. The dialog behind ⌘O still exists for
 * managing them in bulk; this is the everyday switcher — one click, and you
 * can see what else is there without opening anything.
 */
export function Sidebar({
  collapsed,
  onToggle,
  width,
}: {
  collapsed: boolean
  onToggle: () => void
  /** Owned by `panels.ts` — the divider beside this column writes it. */
  width: number
}) {
  const canvasId = useStore((s) => s.canvasId)
  const canvasName = useStore((s) => s.canvasName)
  const savedAt = useStore((s) => s.canvasSavedAt)
  const dirty = useStore((s) => s.canvasDirty)
  const nodeCount = useStore((s) => s.nodes.length)
  const [list, setList] = useState<CanvasMeta[] | null>(null)

  const refresh = useCallback(() => {
    listSavedCanvases()
      .then(setList)
      .catch(() => setList([]))
  }, [])

  // Re-read after every save: autosave changes the timestamp and node count of
  // the row you're looking at, and the first save adds a row outright.
  useEffect(refresh, [refresh, canvasId, savedAt, canvasName])

  if (collapsed) return null

  // A canvas with work in it but no file yet has no row of its own; show it
  // where it will land, so the list isn't missing what's on screen.
  const unsaved = !canvasId && nodeCount > 0

  return (
    <aside
      className="gt-sidebar flex h-full shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-panel"
      style={{ width }}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="font-mono text-[10px] tracking-widest text-fg-muted uppercase">
          Canvases
        </span>
        <span className="font-mono text-[10px] text-fg-faint">{list?.length || ''}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-5 w-5"
          title="Hide sidebar  ⌘B"
          onClick={onToggle}
        >
          <PanelLeftClose size={12} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
        {unsaved && (
          <div className="flex items-center gap-2 rounded-md bg-veil-strong px-2 py-1">
            <Layers size={11} className="shrink-0 text-fg-muted" />
            <span className="truncate text-[12px] text-fg">{canvasName}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">not saved</span>
          </div>
        )}

        {list === null && (
          <p className="px-2 py-3 font-mono text-[10.5px] text-fg-faint">loading…</p>
        )}
        {list?.length === 0 && !unsaved && (
          <p className="px-2 py-3 font-mono text-[10.5px] leading-relaxed text-fg-faint">
            No saved canvases yet. ⌘S saves this one.
          </p>
        )}
        {list?.map((c) => (
          <Row
            key={c.id}
            canvas={c}
            current={c.id === canvasId}
            dirty={dirty}
            guard={unsaved}
            onDeleted={refresh}
          />
        ))}
      </div>

      <footer className="shrink-0 border-t border-veil-line px-1.5 py-1.5">
        <Button
          variant="ghost"
          size="xs"
          className="w-full justify-start text-fg-subtle"
          onClick={() => newCanvas()}
        >
          <FilePlus2 size={11} /> New canvas
        </Button>
        {savedAt && (
          <p className="px-2 pt-1 font-mono text-[10px] text-fg-faint">saved {timeAgo(savedAt)}</p>
        )}
      </footer>
    </aside>
  )
}
