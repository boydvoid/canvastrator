import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FolderOpen, GitBranch, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { gitBranch, pickPath } from '@/lib/bridge'
import { basename, useStore, type GtNode } from '@/lib/store'
import type { FolderNodeData } from '@/lib/types'
import { cn } from '@/lib/utils'

/** " session" / " sessions" — the noun only appears on the last count. */
const plural = (n: number) => ` session${n > 1 ? 's' : ''}`

function FolderNodeInner({ id, data, selected }: NodeProps<GtNode & { type: 'folder' }>) {
  const d = data as FolderNodeData
  const removeNode = useStore((s) => s.removeNode)
  // A folder may be one session's working directory and another's extra root
  // at the same time — primacy is a property of the edge, not the folder — so
  // the footer counts both and names each role.
  const cwdCount = useStore(
    (s) => s.edges.filter((e) => e.source === id && e.type === 'cwd').length,
  )
  const attachCount = useStore(
    (s) => s.edges.filter((e) => e.source === id && e.type === 'attach').length,
  )

  // Read rather than stored: a branch changes under the app — the agent
  // commits, the user switches — and a remembered one would be a label that
  // used to be true. Nothing here has to be persisted for the same reason.
  const [branch, setBranch] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (d.missing) return setBranch(null)
    void gitBranch(d.path)
      .then((b) => live && setBranch(b))
      .catch(() => live && setBranch(null))
    return () => {
      live = false
    }
  }, [d.path, d.missing])

  const wt = d.worktree
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const createWorktree = useStore((s) => s.createWorktree)
  const removeWorktree = useStore((s) => s.removeWorktree)

  useEffect(() => {
    if (d.draft) nameRef.current?.focus()
  }, [d.draft])

  const cut = async () => {
    setBusy(true)
    setError(null)
    const out = await createWorktree(id, name)
    setBusy(false)
    if (out) setError(out.error)
  }

  const drop = async () => {
    const out = await removeWorktree(id)
    if (out) setError(out.error)
  }

  const rechoose = async () => {
    const picked = await pickPath(true)
    if (!picked) return
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && n.type === 'folder'
          ? { ...n, data: { ...n.data, path: picked, missing: false } }
          : n,
      ) as GtNode[],
    }))
  }

  return (
    <div
      className={cn(
        'gt-spawn w-64 rounded-xl border bg-panel/90 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
        d.missing && 'border-[var(--color-danger)]',
      )}
    >
      {/* A folder feeds sessions; it never receives. One handle for both
          roles: the first folder wired into a session becomes its working
          directory and the rest are extra roots, so which of the two an edge
          is depends on the session it lands on, not on where it was dragged
          from. */}
      <Handle
        type="source"
        position={Position.Right}
        id="cwd-out"
        title="Drag onto a session — the first folder is its working directory, the rest are extra roots"
      />

      {d.draft ? (
        <div className="flex flex-col gap-1.5 px-2.5 py-2">
          <span className="flex items-center gap-2">
            <GitBranch size={13} className="shrink-0 text-fg-muted" />
            <span className="font-mono text-[10px] tracking-[0.11em] text-fg-faint">WORKTREE</span>
            <Button variant="ghost" size="icon" className="ml-auto" onClick={() => void drop()} title="Discard">
              <Trash2 size={12} />
            </Button>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="shrink-0 font-mono text-[11px] text-fg-faint">wt/</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !busy) void cut()
                // A name nobody typed is a node nobody wanted.
                if (e.key === 'Escape' && !name) void drop()
              }}
              placeholder="branch name"
              spellCheck={false}
              disabled={busy}
              className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
            />
          </span>
          <span className="truncate font-mono text-[9.5px] text-fg-faint" title={wt?.repo}>
            {busy ? 'cutting the checkout…' : `from ${basename(wt?.repo ?? '')} · ⏎ to create`}
          </span>
          {error && (
            <span className="font-mono text-[9.5px] leading-snug text-[var(--color-danger)]">
              {error}
            </span>
          )}
        </div>
      ) : (
      <div className="flex items-center gap-2 px-2.5 py-2">
        {d.missing ? (
          <TriangleAlert size={13} className="shrink-0 text-[var(--color-danger)]" />
        ) : (
          <FolderOpen size={13} className="shrink-0 text-fg-muted" />
        )}
        <button
          onClick={rechoose}
          className="min-w-0 flex-1 text-left"
          title={`${d.path}\nClick to choose another folder`}
        >
          <div className="truncate font-mono text-[12px] text-fg">{basename(d.path)}</div>
          <div className="truncate font-mono text-[10px] text-fg-faint">
            {d.missing ? 'folder not found' : d.path.replace(/^\/Users\/[^/]+/, '~')}
          </div>
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => (wt ? void drop() : removeNode(id))}
          title={
            wt
              ? 'Delete this checkout. Refused while it holds uncommitted work.'
              : 'Remove from the canvas'
          }
        >
          <Trash2 size={12} />
        </Button>
      </div>
      )}

      {!d.draft && (branch || wt) && (
        <div className="flex items-center gap-1.5 border-t border-line-soft px-2.5 py-1">
          <GitBranch size={10} className="shrink-0 text-fg-faint" />
          {/* An agent's own checkout is worth calling out: it is the difference
              between a diff you can attribute and one you cannot. */}
          <span
            className={cn(
              'min-w-0 truncate font-mono text-[10px]',
              wt || branch?.startsWith('wt/') ? 'text-[var(--color-live)]' : 'text-fg-muted',
            )}
            title={wt ? `Cut from ${wt.repo}` : 'The main checkout'}
          >
            {branch ?? wt?.branch}
          </span>
          {wt && (
            <span className="ml-auto shrink-0 truncate font-mono text-[9px] text-fg-faint">
              from {basename(wt.repo)}
            </span>
          )}
          {error && !d.draft && (
            <span className="ml-auto shrink-0 truncate font-mono text-[9px] text-[var(--color-danger)]" title={error}>
              {error.replace(/^Error:\s*/, '').split('\n')[0]}
            </span>
          )}
        </div>
      )}

      <div className="border-t border-line-soft px-2.5 py-1 font-mono text-[10px] text-fg-faint">
        {cwdCount === 0 && attachCount === 0
          ? 'wire into a session to set its cwd'
          : [
              cwdCount ? `cwd for ${cwdCount}${attachCount ? '' : plural(cwdCount)}` : null,
              attachCount ? `reachable by ${attachCount}${plural(attachCount)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
      </div>
    </div>
  )
}

export const FolderNode = memo(FolderNodeInner)
