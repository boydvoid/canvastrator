import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Check, Copy } from 'lucide-react'
import { monaco } from '@/lib/monaco'
import { monacoLanguage } from '@/lib/filekind'
import { cn } from '@/lib/utils'

/**
 * Syntax-highlighted code block. Monaco is already bundled for the file
 * editor, and `colorize` hands back tokenized HTML — so chat code matches the
 * editor's theme for free, without pulling in a second highlighter.
 */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    // `lang` is whatever the fence said — map it the same way file nodes do,
    // so ```ts and a .ts file highlight identically.
    const language = lang ? monacoLanguage(`x.${lang}`) : 'plaintext'
    monaco.editor
      .colorize(code, language, { tabSize: 2 })
      .then((out) => live && setHtml(out))
      .catch(() => live && setHtml(null))
    return () => {
      live = false
    }
  }, [code, lang])

  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="group/code my-1.5 overflow-hidden rounded-md border border-line bg-canvas">
      <div className="flex items-center gap-2 border-b border-line-soft px-2 py-0.5">
        <span className="font-mono text-[9.5px] tracking-wide text-fg-faint uppercase">
          {lang || 'text'}
        </span>
        <button
          onClick={copy}
          className="ml-auto rounded p-0.5 text-fg-faint opacity-0 transition-opacity group-hover/code:opacity-100 hover:text-fg-muted"
          title="Copy"
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
        </button>
      </div>
      <pre className="nowheel max-h-72 overflow-auto px-2 py-1.5 font-mono text-[11.5px] leading-[1.6]">
        {html ? (
          <code dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="text-fg-muted">{code}</code>
        )}
      </pre>
    </div>
  )
}

const components: Components = {
  // Tight vertical rhythm: these live in a node a few hundred pixels tall.
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,

  // Slab on headings: distinct enough from Outfit to structure a long reply
  // without reaching for another weight or colour.
  h1: ({ children }) => (
    <h1 className="mt-3.5 mb-1.5 font-slab text-[14px] font-semibold text-fg-strong first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3.5 mb-1.5 font-slab text-[13.5px] font-semibold text-fg-strong first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 font-slab text-[12.5px] font-medium text-fg first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 font-mono text-[11px] tracking-wide text-fg-muted uppercase first:mt-0">
      {children}
    </h4>
  ),

  // Real list markers rather than pseudo-element tricks: a clever variant that
  // fails to compile leaves the list with no markers at all.
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-4 marker:text-fg-faint">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5 marker:text-fg-subtle">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5 [&>p]:my-0">{children}</li>,

  strong: ({ children }) => <strong className="font-semibold text-fg-strong">{children}</strong>,
  em: ({ children }) => <em className="text-fg italic">{children}</em>,
  del: ({ children }) => <del className="text-fg-subtle">{children}</del>,

  a: ({ href, children }) => (
    <a
      href={href}
      // Navigating the webview would replace the whole app; hand it to the OS.
      onClick={(e) => {
        e.preventDefault()
        if (href) void openUrl(href).catch(() => {})
      }}
      className="underline decoration-fg-faint underline-offset-2 hover:decoration-fg-muted"
      title={href}
    >
      {children}
    </a>
  ),

  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-line-strong pl-2.5 text-fg-muted">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-2.5 border-line" />,

  // Tables need their own scroller — a wide one must not stretch the node.
  table: ({ children }) => (
    <div className="nowheel my-1.5 overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[11.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-line px-2 py-1 text-left font-medium text-fg">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line-soft px-2 py-1 align-top text-fg-muted">{children}</td>
  ),

  code: ({ className, children, ...props }) => {
    const text = String(children ?? '')
    const fence = /language-(\w+)/.exec(className ?? '')
    // react-markdown routes both inline code and fenced blocks here; a fence
    // carries a language class or a trailing newline.
    if (fence || text.includes('\n')) {
      return <CodeBlock code={text.replace(/\n$/, '')} lang={fence?.[1]} />
    }
    return (
      <code
        className="rounded border border-line bg-canvas px-1 py-px font-mono text-[11.5px] text-fg"
        {...props}
      >
        {text}
      </code>
    )
  },
  pre: ({ children }) => <>{children}</>,
}

/**
 * While a reply streams, re-parsing markdown on every token gets expensive and
 * leaves half-written fences flickering. Throttle the source instead.
 */
function useThrottled(value: string, active: boolean, ms = 150) {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) {
      if (timer.current) clearTimeout(timer.current)
      setShown(value)
      return
    }
    const since = Date.now() - last.current
    if (since >= ms) {
      last.current = Date.now()
      setShown(value)
      return
    }
    timer.current = setTimeout(() => {
      last.current = Date.now()
      setShown(value)
    }, ms - since)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, active, ms])

  return shown
}

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
  className,
}: {
  text: string
  streaming?: boolean
  className?: string
}) {
  const source = useThrottled(text, streaming)
  return (
    <div className={cn('text-[12.5px] leading-[1.65] break-words text-fg', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  )
})
