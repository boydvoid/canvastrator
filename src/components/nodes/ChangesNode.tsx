import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { FilePen, GitPullRequestArrow } from 'lucide-react'
import { useAuthors, useChangedFiles, useStats } from '@/components/changed'
import { timeAgo } from '@/lib/ago'
import { statLabel } from '@/lib/changes'
import { useStore, type GtNode } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Everything the agents on this canvas have written, and how much of it.
 *
 * The last question of a run, and the one the canvas answered worst. A green
 * edge says a file was touched; it does not say whether that was a typo or a
 * rewrite, and deciding whether to keep the work means knowing which.
 *
 * Clicking a row opens it in the diff view, where the change can be read hunk
 * by hunk and reverted a hunk at a time. There is deliberately no
 * revert-everything button here: the baseline is git HEAD, so "revert the run"
 * means discarding every uncommitted change in the repository — including
 * whatever you were doing before the agents started. That belongs to git, with
 * git's own confirmations, not to a button on a canvas.
 */
function ChangesNodeInner({ selected }: NodeProps<GtNode & { type: 'changes' }>) {
  const openFile = useStore((s) => s.openFile)
  const files = useChangedFiles()
  const statFor = useStats(files)
  const authorOf = useAuthors()

  return (
    <div
      className={cn(
        'gt-spawn flex max-h-[420px] w-[330px] flex-col overflow-hidden rounded-xl border bg-panel/90 backdrop-blur',
        selected ? 'border-line-strongest' : 'border-line',
      )}
    >
      <div className="flex shrink-0 items-center gap-2 bg-surface-2/70 px-3 py-1.5">
        <GitPullRequestArrow size={11} className="shrink-0 text-fg-muted" />
        <span className="font-mono text-[9px] tracking-[0.11em] text-fg-faint">CHANGES</span>
        <span className="ml-auto font-mono text-[9.5px] text-fg-subtle">
          {files.length === 0
            ? 'nothing written'
            : `${files.length} file${files.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {files.length === 0 ? (
        <p className="px-3 py-4 text-[11px] leading-snug text-fg-faint">
          Nothing written yet. Files an agent changes appear here with what changed in them,
          measured against your last commit.
        </p>
      ) : (
        <div className="nowheel min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {files.map((f) => {
            const stat = statFor(f)
            const name = f.path.split('/').filter(Boolean).pop() ?? f.path
            const dir = f.path.slice(0, f.path.length - name.length).replace(/\/$/, '')
            const counted = stat.reason === null || stat.untracked
            return (
              <button
                key={f.id}
                onClick={() => openFile(f.path)}
                title={`${f.path}\nClick to read the change, hunk by hunk`}
                className="flex w-full min-w-0 items-center gap-2.5 border-b border-line-soft px-3 py-2 text-left last:border-b-0 hover:bg-surface"
              >
                <FilePen size={11} className="shrink-0 text-[var(--color-live)]" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-[10.5px] text-fg">{name}</span>
                  <span className="truncate font-mono text-[8.5px] text-fg-faint">
                    {authorOf[f.id] ? `${authorOf[f.id]} · ` : ''}
                    {f.touchedAt ? timeAgo(f.touchedAt) : dir || '—'}
                  </span>
                </span>
                {counted ? (
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
                    <span className="text-[var(--color-live)]">+{stat.added}</span>
                    <span className="text-[var(--color-danger)]">−{stat.removed}</span>
                  </span>
                ) : (
                  <span className="shrink-0 font-mono text-[9px] text-fg-faint">
                    {statLabel(stat)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-canvas/40 px-3 py-1.5">
        <span className="font-mono text-[9px] text-fg-faint">
          {files.length ? 'click a file to review and revert hunk by hunk' : 'measured against HEAD'}
        </span>
      </div>
    </div>
  )
}

export const ChangesNode = memo(ChangesNodeInner)
