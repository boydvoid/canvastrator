import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleStop, CornerDownLeft, FileCode2, Slash, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  discoverSkills,
  listProjectFiles,
  removeSessionImage,
  writeSessionImage,
} from '@/lib/bridge'
import { useStore } from '@/lib/store'
import type { DiscoveredSkill, Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

/** An image that's been pasted in and is waiting to go with the next message. */
type Attachment = {
  /** Where it landed on disk. What the CLI is actually given. */
  path: string
  /** The same bytes, for the thumbnail — no round trip back through Rust. */
  src: string
}

/**
 * The largest paste we take. A retina screenshot of a 6K display lands around
 * 8 MB; past that it is a photo or a video frame, and the whole of it has to be
 * base64'd into one string and pushed across the IPC boundary. Checked here so
 * the user gets a message instead of a stall; `MAX_BYTES` in `images.rs` is the
 * same limit enforced at the boundary itself.
 */
const MAX_PASTE_BYTES = 10 * 1024 * 1024

/**
 * A clipboard or dropped image, base64'd. `readAsDataURL` is the only way to
 * get bytes out of a `File` without a second copy, so the prefix is trimmed
 * back off rather than encoding by hand.
 */
const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

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
  sessionId,
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
  /** Where pasted images are parked, so a deleted session takes them with it. */
  sessionId: string
  /** Only used to scope skill discovery to the project. */
  cwd: string | null
  /** Folder nodes this session can reach. Nothing else is searchable. */
  roots: string[]
  /** File nodes already on the canvas — mentionable without a search. */
  canvasFiles: { path: string; name: string }[]
  provider: Provider
  /** Slash commands and skills the session reported at startup. */
  liveCommands: string[]
  onSend: (text: string, images: string[]) => void
  onInterrupt: () => void
}) {
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<Attachment[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [caret, setCaret] = useState(0)
  const [items, setItems] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const seed = useStore((s) => s.composerSeed)
  const clearSeed = useStore((s) => s.clearComposerSeed)
  const skillsRef = useRef<DiscoveredSkill[] | null>(null)

  const token = dismissed ? null : activeToken(draft, caret)

  // Reopen the menu as soon as a new token starts.
  useEffect(() => setDismissed(false), [token?.trigger, token?.start])

  /**
   * Text handed over by another surface — the Skills panel naming a skill.
   *
   * Appended rather than assigned: you may already be halfway through a
   * sentence when you reach for one, and replacing what you typed to insert a
   * skill name would be a worse trade than an odd-looking line you can edit.
   * Focus follows, because the next thing to happen is typing.
   */
  useEffect(() => {
    if (!seed) return
    setDraft((d) => (d ? `${d.trimEnd()} ${seed}` : seed))
    clearSeed()
    const el = ref.current
    if (el) {
      el.focus()
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
    }
  }, [seed, clearSeed])

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

  /**
   * Everything image-shaped out of a paste or a drop. The files go to disk
   * before the message does: the CLIs take a path, never bytes, and a 1 MB
   * ARG_MAX rules out carrying them in the prompt.
   */
  const attach = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith('image/'))
    if (!pics.length) return
    setImageError(null)
    for (const file of pics) {
      // Before `base64Of`: reading a 200 MB drop to find out it's too big is
      // the stall this is here to avoid.
      if (file.size > MAX_PASTE_BYTES) {
        setImageError(
          `${file.name || 'image'} is ${Math.round(file.size / 1_048_576)} MB — the limit is ${MAX_PASTE_BYTES / 1_048_576} MB`,
        )
        continue
      }
      try {
        const base64 = await base64Of(file)
        const path = await writeSessionImage(sessionId, base64, file.type)
        setImages((prev) => [...prev, { path, src: `data:${file.type};base64,${base64}` }])
      } catch (e) {
        setImageError(String(e))
      }
    }
  }

  /** Take one off, and take its file with it — nothing is coming back for it. */
  const detach = (path: string) => {
    setImages((prev) => prev.filter((i) => i.path !== path))
    void removeSessionImage(sessionId, path).catch(() => {})
  }

  // Images are written to disk the moment they're pasted, so anything still
  // attached when this composer goes away — the user switched chat target, or
  // closed the panel — is a file nothing will ever send. A ref, because the
  // cleanup runs once and must see the last state, not the state it closed over.
  const unsent = useRef<Attachment[]>([])
  unsent.current = images
  useEffect(
    () => () => {
      for (const img of unsent.current) void removeSessionImage(sessionId, img.path).catch(() => {})
    },
    [sessionId],
  )

  const submit = () => {
    const text = draft.trim()
    // An image on its own is a message: "what's wrong with this?" is often the
    // whole of what the user means to say.
    if ((!text && !images.length) || busy) return
    setDraft('')
    setImages([])
    setImageError(null)
    setDismissed(true)
    onSend(text, images.map((i) => i.path))
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

      {(images.length > 0 || imageError) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {images.map((img) => (
            <div key={img.path} className="group relative">
              <img
                src={img.src}
                alt={img.path.split('/').pop()}
                className="h-12 w-12 rounded border border-line object-cover"
              />
              <button
                onClick={() => detach(img.path)}
                title="Remove"
                className="absolute -top-1 -right-1 rounded-full border border-line-strong bg-panel p-0.5 text-fg-muted opacity-0 group-hover:opacity-100 hover:text-fg"
              >
                <X size={9} />
              </button>
            </div>
          ))}
          {imageError && (
            <span className="text-[10px] leading-snug text-danger">{imageError}</span>
          )}
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
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            // Only swallow the paste when it actually carried an image;
            // copying a screenshot alongside text should still paste the text.
            if (!files.some((f) => f.type.startsWith('image/'))) return
            e.preventDefault()
            void attach(files)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const files = [...e.dataTransfer.files]
            if (!files.some((f) => f.type.startsWith('image/'))) return
            e.preventDefault()
            void attach(files)
          }}
          rows={2}
          placeholder={placeholder}
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-md border border-line bg-canvas px-2 py-1.5 text-[12.5px] leading-[1.55] text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
        />
        {busy ? (
          <Button variant="danger" size="icon" onClick={onInterrupt} title="Interrupt">
            <CircleStop size={13} />
          </Button>
        ) : (
          <Button size="icon" onClick={submit} disabled={!draft.trim() && !images.length} title="Send  ↵   ·   Shift ↵ for a new line">
            <CornerDownLeft size={13} />
          </Button>
        )}
      </div>
    </div>
  )
}
