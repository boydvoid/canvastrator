import { useEffect, useState } from 'react'
import { ArrowRight, Check, Dot, GitBranch, GitPullRequestArrow } from 'lucide-react'
import { FloatingPanel } from '@/components/panels/FloatingPanel'
import { useAuthors, useChangedFiles, useStats } from '@/components/changed'
import { gitBranch } from '@/lib/bridge'
import { shortPath, statLabel } from '@/lib/changes'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The branch the work is landing on, read once per set of files.
 *
 * Asked of the first file rather than of a working directory: a canvas can
 * have several folders on it, and the only repo that matters here is the one
 * the agents actually wrote into.
 */
function useBranch(path: string | undefined) {
  const [branch, setBranch] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return setBranch(null)
    let live = true
    void gitBranch(path)
      .then((b) => live && setBranch(b))
      .catch(() => live && setBranch(null))
    return () => {
      live = false
    }
  }, [path])
  return branch
}

/**
 * What the agents wrote, and where it is landing.
 *
 * The same list the Changes node carries, floating instead of placed: what
 * changed is a fact about the canvas rather than a thing on it, and during a
 * run it is the panel you leave open next to Pulse. The node stays for the
 * canvases that already have one.
 *
 * The strip under the header is the half the node never had. A run that edited
 * the wrong worktree is invisible in a list of file names — they are the same
 * names — and finding out after reading the diff is finding out late. The
 * branch, the baseline, and the totals answer that in one line.
 *
 * Clicking a row opens it in the diff view, where the change can be read hunk
 * by hunk and reverted a hunk at a time. There is deliberately no
 * revert-everything button: the baseline is git HEAD, so "revert the run"
 * means discarding every uncommitted change in the repository — including
 * whatever you were doing before the agents started. That belongs to git, with
 * git's own confirmations, not to a button on a panel.
 */
export function ChangesPanel() {
  const openFile = useStore((s) => s.openFile)
  const files = useChangedFiles()
  const statFor = useStats(files)
  const authorOf = useAuthors()
  const branch = useBranch(files[0]?.path)
  // The root the rows are shown against: the working directory of whichever
  // agent is driving. Without it every row is forty characters of home
  // directory and a truncated filename.
  const root = useStore((s) => {
    const cwds = s.nodes
      .filter((n) => n.type === 'session')
      .map((n) => (n.data as { cwd?: string }).cwd)
      .filter((c): c is string => !!c)
    // The shortest cwd contains the others when a canvas mixes a repo and a
    // subdirectory of it, which is the common case.
    return cwds.sort((a, b) => a.length - b.length)[0]
  })

  // Every agent's verdict, folded into the canvas's. A run is only as landed
  // as its worst check: one failing agent among five is a run you do not merge,
  // and a panel that reported "3 pass" would be technically true and useless.
  const checks = useStore((s) =>
    s.nodes
      .filter((n) => n.type === 'session')
      .map((n) => (n.data as { check?: { state: string } }).check?.state)
      .filter((v): v is string => !!v)
      .join(','),
  )
  const states = checks ? checks.split(',') : []
  const verdict = states.includes('fail')
    ? 'fail'
    : states.includes('running')
      ? 'running'
      : states.includes('pass')
        ? 'pass'
        : null

  const counted = files.map(statFor).filter((s) => s.reason === null || s.untracked)
  const added = counted.reduce((a, s) => a + s.added, 0)
  const removed = counted.reduce((a, s) => a + s.removed, 0)

  return (
    <FloatingPanel
      panel="changes"
      title="CHANGES"
      Icon={GitPullRequestArrow}
      badge={
        <span className="font-mono text-[9.5px] text-fg-subtle">
          {files.length === 0
            ? 'nothing written'
            : `${files.length} file${files.length === 1 ? '' : 's'} this run`}
        </span>
      }
    >
      {files.length === 0 ? (
        <p className="px-3.5 py-4 text-[11px] leading-snug text-fg-faint">
          Nothing written yet. Files an agent changes appear here with what changed in them,
          measured against your last commit.
        </p>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3.5 py-[9px]">
            <GitBranch size={11} className="shrink-0 text-fg-faint" />
            <span className="truncate font-mono text-[10px] text-fg-muted">
              {branch ?? 'no branch'}
            </span>
            <ArrowRight size={10} className="shrink-0 text-fg-faint" />
            <span className="shrink-0 font-mono text-[10px] text-fg-subtle">HEAD</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
              <span className="text-[var(--color-live)]">+{added}</span>
              <span className="text-[var(--color-danger)]">−{removed}</span>
            </span>
          </div>

          <div className="max-h-64 overflow-y-auto overscroll-contain">
            {files.map((f) => {
              const stat = statFor(f)
              const known = stat.reason === null || stat.untracked
              const shown = shortPath(f.path, root)
              return (
                <button
                  key={f.id}
                  onClick={() => openFile(f.path)}
                  title={`${f.path}\nClick to read the change, hunk by hunk`}
                  className="flex w-full min-w-0 items-center gap-2.5 border-b border-line-soft px-3.5 py-[9px] text-left last:border-b-0 hover:bg-surface-2"
                >
                  {/* A file whose numbers are in is settled; one still being
                      counted gets the unfinished dot rather than a tick it has
                      not earned. */}
                  {known ? (
                    <Check size={12} className="shrink-0 text-[var(--color-live)]" />
                  ) : (
                    <Dot size={12} className="shrink-0 text-[var(--color-claude)]" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {/* Already trimmed to the part that differs, so ordinary
                        truncation cannot eat the filename. */}
                    <span className="truncate font-mono text-[10.5px] text-fg">{shown}</span>
                    <span className="truncate font-mono text-[8.5px] text-fg-faint">
                      {authorOf[f.id] ? `by ${authorOf[f.id]}` : 'written on this canvas'}
                    </span>
                  </span>
                  {known ? (
                    <>
                      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-[var(--color-live)] tabular-nums">
                        +{stat.added}
                      </span>
                      <span className="w-7 shrink-0 text-right font-mono text-[10px] text-[var(--color-danger)] tabular-nums">
                        −{stat.removed}
                      </span>
                    </>
                  ) : (
                    <span className="shrink-0 font-mono text-[9px] text-fg-faint">
                      {statLabel(stat)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {verdict && (
            <div
              className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-2"
              style={{
                background:
                  verdict === 'fail'
                    ? 'color-mix(in oklch, var(--color-danger) 14%, transparent)'
                    : undefined,
              }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    verdict === 'pass'
                      ? 'var(--color-live)'
                      : verdict === 'fail'
                        ? 'var(--color-danger)'
                        : 'var(--color-work)',
                }}
              />
              <span
                className={cn(
                  'truncate font-mono text-[10px]',
                  verdict === 'fail' ? 'text-[var(--color-danger)]' : 'text-fg-muted',
                )}
              >
                {verdict === 'running'
                  ? 'checks running'
                  : verdict === 'fail'
                    ? `${states.filter((v) => v === 'fail').length} of ${states.length} agents failing checks`
                    : `checks pass on ${states.length} agent${states.length === 1 ? '' : 's'}`}
              </span>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-2.5 border-t border-line bg-panel px-3.5 py-2.5">
            <button
              onClick={() => files[0] && openFile(files[0].path)}
              className="flex-1 rounded-md bg-fg px-3 py-[7px] text-center font-mono text-[10px] text-canvas hover:brightness-110"
            >
              Review the diff
            </button>
            <span className="shrink-0 font-mono text-[9px] text-fg-faint">against HEAD</span>
          </div>
        </>
      )}
    </FloatingPanel>
  )
}
