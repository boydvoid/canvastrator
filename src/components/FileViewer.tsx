import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { FileWarning, GitCompare, RotateCcw, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { monacoTheme } from '@/lib/monaco'
import { useTheme } from '@/lib/theme'
import { fileDiffBase, readBinaryBase64, readTextFile, writeTextFile } from '@/lib/bridge'
import { computeHunks, describeHunk, hunkRange, revertHunk } from '@/lib/hunks'
import { fileKind, mimeFor, monacoLanguage } from '@/lib/filekind'
import { basename, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/** Above this we stop pretending an editor is the right tool. */
const MAX_TEXT_BYTES = 2_000_000
const MAX_BINARY_BYTES = 20_000_000

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'text'; text: string; truncated: boolean; bytes: number }
  | { state: 'binary'; dataUri: string; bytes: number }
  | { state: 'unsupported'; bytes?: number }

export function FileViewer() {
  const path = useStore((s) => s.openFilePath)
  const close = useCallback(() => useStore.setState({ openFilePath: null }), [])
  const { theme } = useTheme()

  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // The committed version, and whether we're showing the comparison.
  const [base, setBase] = useState<{ original: string | null; reason: string | null } | null>(null)
  const [diffing, setDiffing] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const originalRef = useRef('')

  const kind = path ? fileKind(path) : 'binary'
  const dirty = loaded.state === 'text' && draft !== originalRef.current

  useEffect(() => {
    if (!path) return
    setLoaded({ state: 'loading' })
    setSaveError(null)

    if (kind === 'image' || kind === 'pdf') {
      readBinaryBase64(path, MAX_BINARY_BYTES)
        .then((b) =>
          setLoaded({
            state: 'binary',
            dataUri: `data:${mimeFor(path)};base64,${b.base64}`,
            bytes: b.bytes,
          }),
        )
        .catch((e: unknown) => setLoaded({ state: 'error', message: String(e) }))
      return
    }
    if (kind === 'binary') {
      setLoaded({ state: 'unsupported' })
      return
    }

    readTextFile(path, MAX_TEXT_BYTES)
      .then((f) => {
        originalRef.current = f.text
        setDraft(f.text)
        setLoaded({ state: 'text', text: f.text, truncated: f.truncated, bytes: f.bytes })
      })
      .catch((e: unknown) => setLoaded({ state: 'error', message: String(e) }))

    // Fetched alongside: whether there's anything to compare decides whether
    // the diff toggle is even offered.
    setDiffing(false)
    fileDiffBase(path)
      .then((b) => setBase({ original: b.original, reason: b.reason }))
      .catch(() => setBase(null))
  }, [path, kind])

  const save = useCallback(async () => {
    if (!path || loaded.state !== 'text' || !dirty) return
    // Saving a truncated read would delete everything past the cut.
    if (loaded.truncated) {
      setSaveError('File was truncated on load — saving would discard the rest.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await writeTextFile(path, draft)
      originalRef.current = draft
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }, [path, loaded, dirty, draft])

  // Esc closes, ⌘S saves — captured at the document so Monaco doesn't swallow them.
  useEffect(() => {
    if (!path) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [path, close, save])

  if (!path) return null

  return (
    <div
      data-shortcuts="off"
      className="absolute inset-0 z-50 grid place-items-center bg-canvas/70 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="flex h-[86vh] w-[min(1180px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line-soft px-3 py-2">
          <span className="truncate font-mono text-[12px] text-fg">{basename(path)}</span>
          <span className="truncate font-mono text-[10px] text-fg-faint">
            {path.replace(/^\/Users\/[^/]+/, '~')}
          </span>

          {loaded.state === 'text' && loaded.truncated && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-[color-mix(in_oklch,var(--color-danger)_16%,transparent)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-danger)]">
              <FileWarning size={10} /> truncated · read-only
            </span>
          )}
          {dirty && !loaded.truncated && (
            <span className="shrink-0 font-mono text-[10px] text-[var(--color-live)]">
              ● unsaved
            </span>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {loaded.state === 'text' && base?.original != null && base.original !== draft && (
              <Button
                variant={diffing ? 'subtle' : 'ghost'}
                size="xs"
                onClick={() => setDiffing((v) => !v)}
                title="Compare with the last commit"
              >
                <GitCompare size={11} />
                {diffing ? 'editing' : `${computeHunks(base.original, draft).length} changes`}
              </Button>
            )}
            {loaded.state === 'text' && (
              <Button
                variant={dirty ? 'default' : 'ghost'}
                size="xs"
                onClick={() => void save()}
                disabled={!dirty || saving || loaded.truncated}
                title="Save  ⌘S"
              >
                <Save size={11} />
                {saving ? 'saving…' : 'Save'}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={close} title="Close  Esc">
              <X size={13} />
            </Button>
          </div>
        </header>

        {saveError && (
          <div className="shrink-0 border-b border-line-soft bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-danger)]">
            {saveError}
          </div>
        )}

        <div className={cn('min-h-0 flex-1', loaded.state === 'binary' && 'overflow-auto')}>
          {loaded.state === 'loading' && (
            <p className="p-6 font-mono text-[11px] text-fg-faint">loading…</p>
          )}

          {loaded.state === 'error' && (
            <p className="p-6 font-mono text-[11px] text-[var(--color-danger)]">{loaded.message}</p>
          )}

          {loaded.state === 'unsupported' && (
            <p className="p-6 font-mono text-[11px] text-fg-subtle">
              Binary file — nothing sensible to show.
            </p>
          )}

          {loaded.state === 'binary' &&
            (fileKind(path) === 'pdf' ? (
              <iframe src={loaded.dataUri} title={basename(path)} className="h-full w-full" />
            ) : (
              <div className="grid h-full place-items-center p-6">
                <img
                  src={loaded.dataUri}
                  alt={basename(path)}
                  className="max-h-full max-w-full object-contain"
                  style={{ imageRendering: 'auto' }}
                />
              </div>
            ))}

          {/* .txt and friends get a plain text box, not a code editor. */}
          {loaded.state === 'text' && !diffing && kind === 'text' && (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              readOnly={loaded.truncated}
              className="h-full w-full resize-none bg-canvas p-4 font-mono text-[12px] leading-relaxed text-fg outline-none"
            />
          )}

          {loaded.state === 'text' && diffing && base?.original != null && (
            <div className="flex h-full min-h-0">
              <div className="min-w-0 flex-1">
                <DiffEditor
                  height="100%"
                  theme={monacoTheme(theme)}
                  language={monacoLanguage(path)}
                  original={base.original}
                  modified={draft}
                  onMount={(editor) => {
                    // The right-hand side is the working file, so edits here
                    // are edits to it — same as the plain editor.
                    editor.getModifiedEditor().onDidChangeModelContent(() => {
                      setDraft(editor.getModifiedEditor().getValue())
                    })
                  }}
                  options={{
                    readOnly: true,
                    originalEditable: false,
                    renderSideBySide: true,
                    fontSize: 12.5,
                    fontFamily: "'JetBrains Mono Variable', ui-monospace, Menlo, monospace",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>

              {/* One change at a time: an agent's edit is usually several
                  unrelated changes and you want three of them, not all four. */}
              <div className="w-56 shrink-0 space-y-1 overflow-y-auto border-l border-line-soft p-2">
                <div className="px-1 pb-1 font-mono text-[10px] tracking-widest text-fg-muted uppercase">
                  changes
                </div>
                {computeHunks(base.original, draft).map((h, i) => (
                  <div
                    key={`${h.modifiedStart}-${i}`}
                    className="flex items-center gap-1.5 rounded border border-line bg-surface/40 px-1.5 py-1"
                  >
                    <span
                      className={cn(
                        'font-mono text-[9.5px]',
                        describeHunk(h) === 'added'
                          ? 'text-[var(--color-live)]'
                          : describeHunk(h) === 'removed'
                            ? 'text-[var(--color-danger)]'
                            : 'text-fg-muted',
                      )}
                    >
                      {describeHunk(h)}
                    </span>
                    <span className="truncate font-mono text-[9.5px] text-fg-faint">
                      {hunkRange(h)}
                    </span>
                    <button
                      onClick={() => setDraft(revertHunk(base.original!, draft, i))}
                      className="ml-auto shrink-0 rounded p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
                      title="Revert this change"
                    >
                      <RotateCcw size={10} />
                    </button>
                  </div>
                ))}
                {computeHunks(base.original, draft).length === 0 && (
                  <p className="px-1 py-2 text-[10.5px] leading-snug text-fg-faint">
                    Matches the last commit.
                  </p>
                )}
              </div>
            </div>
          )}

          {loaded.state === 'text' && !diffing && kind === 'code' && (
            <Editor
              height="100%"
              theme={monacoTheme(theme)}
              path={path}
              language={monacoLanguage(path)}
              value={draft}
              onChange={(v) => setDraft(v ?? '')}
              loading={<p className="p-6 font-mono text-[11px] text-fg-faint">starting editor…</p>}
              options={{
                readOnly: loaded.truncated,
                fontSize: 12.5,
                fontFamily: "'Berkeley Mono', 'SF Mono', ui-monospace, Menlo, monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                renderWhitespace: 'selection',
                padding: { top: 12, bottom: 12 },
                tabSize: 2,
              }}
            />
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-line-soft px-3 py-1 font-mono text-[10px] text-fg-faint">
          <span>{kind}</span>
          {loaded.state === 'text' && <span>{monacoLanguage(path)}</span>}
          {'bytes' in loaded && loaded.bytes !== undefined && (
            <span>{loaded.bytes.toLocaleString()} B</span>
          )}
          <span className="ml-auto">esc to close{kind !== 'binary' && ' · ⌘S to save'}</span>
        </footer>
      </div>
    </div>
  )
}
