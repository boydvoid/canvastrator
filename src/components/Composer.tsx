import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleStop, CornerDownLeft, FileCode2, Slash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { discoverSkills, listProjectFiles } from '@/lib/bridge'
import type { DiscoveredSkill, Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

export type Suggestion = {
  /** What gets inserted. For a file, the absolute path. */
  value: string
  /** What gets shown, when it differs from the value. */
  label?: string
  hint?: string
}

/**
 * The token being completed: everything from a trigger character back to
 * whitespace, provided the caret is still inside it.
 *
 * `/` only counts at the very start — mid-sentence slashes are paths and dates,
 * not commands. `@` counts anywhere, since mentioning a file mid-sentence is
 * the normal way to use one.
 */
export function activeToken(
  text: string,
  caret: number,
): { trigger: '/' | '@'; query: string; start: number } | null {
  const before = text.slice(0, caret)
  // Work from the current word, not the last trigger character. Searching for
  // the last `/` finds the one inside `@src/lib/store.ts` and mistakes a file
  // mention for a command — which is to say, nearly every mention.
  const wordStart = Math.max(
    before.lastIndexOf(' '),
    before.lastIndexOf('\n'),
    before.lastIndexOf('\t'),
  ) + 1
  const word = before.slice(wordStart)
  if (!word) return null

  const trigger = word[0]
  if (trigger !== '/' && trigger !== '@') return null
  // `/` only counts as a command at the very start of the message; mid-sentence
  // slashes are paths and dates.
  if (trigger === '/' && before.slice(0, wordStart).trim() !== '') return null

  return { trigger, query: word.slice(1), start: wordStart }
}

export function Composer({
  placeholder,
  busy,
  cwd,
  roots,
  canvasFiles,
  provider,
  liveCommands,
  onSend,
  onInterrupt,
}: {
  placeholder: string
  busy: boolean
  /** Only used to scope skill discovery to the project. */
  cwd: string | null
  /** Folder nodes this session can reach. Nothing else is searchable. */
  roots: string[]
  /** File nodes already on the canvas — mentionable without a search. */
  canvasFiles: { path: string; name: string }[]
  provider: Provider
  /** Slash commands and skills the session reported at startup. */
  liveCommands: string[]
  onSend: (text: string) => void
  onInterrupt: () => void
}) {
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [items, setItems] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const skillsRef = useRef<DiscoveredSkill[] | null>(null)

  const token = dismissed ? null : activeToken(draft, caret)

  // Reopen the menu as soon as a new token starts.
  useEffect(() => setDismissed(false), [token?.trigger, token?.start])

  useEffect(() => {
    let live = true
    if (!token) {
      setItems([])
      return
    }
    const q = token.query.toLowerCase()

    if (token.trigger === '/') {
      const run = async () => {
        if (!skillsRef.current) {
          skillsRef.current = await discoverSkills(cwd).catch(() => [])
        }
        const described = new Map(
          (skillsRef.current ?? []).map((s) => [s.name, s.description]),
        )
        const names = liveCommands.length
          ? liveCommands
          : (skillsRef.current ?? []).filter((s) => s.provider === provider).map((s) => s.name)
        const matches = names
          .filter((n) => n.toLowerCase().includes(q))
          .slice(0, 40)
          .map((n) => ({
            value: n,
            hint: described.get(n) ?? described.get(n.split(':').pop() ?? n),
          }))
        if (live) {
          setItems(matches)
          setActive(0)
        }
      }
      void run()
      return () => {
        live = false
      }
    }

    // `@` — only what the canvas grants: file nodes already placed, and the
    // folder nodes wired into this session. A directory that isn't on the
    // canvas cannot be reached from here.
    const onCanvas = canvasFiles
      .filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      .map((f) => ({ value: f.path, hint: 'on canvas' }))

    if (!roots.length) {
      setItems(onCanvas.slice(0, 40))
      setActive(0)
      return
    }

    void listProjectFiles(roots, token.query, 40)
      .then((files) => {
        if (!live) return
        const seen = new Set(onCanvas.map((f) => f.value))
        const fromDisk = files
          .filter((f) => !seen.has(f.path))
          .map((f) => ({
            value: f.path,
            // Which folder node it came from, when more than one is wired in.
            hint: roots.length > 1 ? f.root : undefined,
            label: f.rel,
          }))
        setItems([...onCanvas, ...fromDisk].slice(0, 60))
        setActive(0)
      })
      .catch(() => live && setItems(onCanvas))
    return () => {
      live = false
    }
  }, [token?.trigger, token?.query, cwd, roots, canvasFiles, provider, liveCommands])

  // The `@` menu opens even when empty, to explain why there's nothing.
  const open = !!token && (items.length > 0 || token.trigger === '@')

  const accept = (choice: Suggestion) => {
    if (!token) return
    const before = draft.slice(0, token.start)
    const after = draft.slice(caret)
    const next = `${before}${token.trigger}${choice.value} ${after}`
    setDraft(next)
    setDismissed(true)
    // Put the caret after what we inserted, not at the end of the message.
    const pos = before.length + choice.value.length + 2
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  const submit = () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setDismissed(true)
    onSend(text)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      // The menu owns these keys while it's up, or picking a suggestion with
      // the keyboard would send the message instead.
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % items.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + items.length) % items.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        accept(items[active])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    // Enter sends; Shift+Enter is a newline. ⌘↵ still works for the muscle
    // memory it built while it was the only way.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      submit()
    }
  }

  const sync = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? 0)

  // Keep the highlighted row in view when arrowing through a long list.
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  return (
    <div className="relative">
      {open && (
        <div
          ref={listRef}
          className="absolute bottom-full left-0 z-30 mb-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-panel/95 p-1 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center gap-1.5 px-2 py-1 font-mono text-[9.5px] tracking-widest text-fg-faint uppercase">
            {token?.trigger === '/' ? <Slash size={9} /> : <FileCode2 size={9} />}
            {token?.trigger === '/' ? 'commands' : 'files'}
            <span className="ml-auto normal-case">↑↓ · ↵ insert · esc</span>
          </div>
          {items.length === 0 && token?.trigger === '@' && (
            <div className="px-2 py-1.5 text-[10.5px] leading-snug text-fg-faint">
              No folders on this canvas are wired into this agent. Add a folder node and
              connect it to search inside it.
            </div>
          )}
          {items.map((it, i) => (
            <button
              key={it.value}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => accept(it)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left',
                i === active ? 'bg-surface-2' : 'hover:bg-surface',
              )}
            >
              <span className="truncate font-mono text-[11px] text-fg">
                {token?.trigger}
                {it.label ?? it.value}
              </span>
              {it.hint && (
                <span className="line-clamp-2 text-[10px] leading-snug text-fg-subtle">
                  {it.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            sync(e.currentTarget)
          }}
          onKeyUp={(e) => sync(e.currentTarget)}
          onClick={(e) => sync(e.currentTarget)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={placeholder}
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-md border border-line bg-canvas px-2 py-1.5 text-[12.5px] leading-[1.55] text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
        />
        {busy ? (
          <Button variant="danger" size="icon" onClick={onInterrupt} title="Interrupt">
            <CircleStop size={13} />
          </Button>
        ) : (
          <Button size="icon" onClick={submit} disabled={!draft.trim()} title="Send  ↵   ·   Shift ↵ for a new line">
            <CornerDownLeft size={13} />
          </Button>
        )}
      </div>
    </div>
  )
}
