import { useEffect, useRef, useState } from 'react'
import { CircleStop, RotateCw, SquareTerminal, X } from 'lucide-react'
import { terminalClose, terminalOpen, terminalResize } from '@/lib/bridge'
import { folderRootsFor, useStore, type GtNode } from '@/lib/store'
import { emulatorFor, sizeOfTerminal } from '@/lib/terminals'

/**
 * A terminal, in the space the conversation usually occupies.
 *
 * The emulator and the shell both outlive this component — it borrows the one
 * and talks to the other. Mounting attaches the existing element and asks Rust
 * for a shell, which is a no-op when one is already running, so switching away
 * and back lands you in the same session with its scrollback intact.
 */
export function TerminalView({ node }: { node: GtNode & { type: 'terminal' } }) {
  const host = useRef<HTMLDivElement>(null)
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const patch = useStore((s) => s.patchTerminal)
  const setChatTarget = useStore((s) => s.setChatTarget)
  const [error, setError] = useState<string | null>(null)

  const d = node.data
  const cwd = folderRootsFor(nodes, edges, node.id).find((r) => r.primary)?.path ?? ''

  useEffect(() => {
    const box = host.current
    if (!box) return
    const { element, fit } = emulatorFor(d.terminalId)
    box.appendChild(element)

    const settle = () => {
      try {
        fit.fit()
      } catch {
        // A fit against a container of zero height throws; the observer below
        // fires again the moment it has one.
        return
      }
      const size = sizeOfTerminal(d.terminalId)
      if (size) void terminalResize(d.terminalId, size.cols, size.rows).catch(() => {})
    }

    settle()

    if (!cwd) {
      setError('No folder wired in. Connect a folder node to this terminal to give its shell a directory.')
    } else {
      setError(null)
      const size = sizeOfTerminal(d.terminalId) ?? { cols: 80, rows: 24 }
      void terminalOpen(d.terminalId, cwd, size.cols, size.rows)
        .then(() => patch(node.id, { running: true, exit: undefined }))
        .catch((e: unknown) => setError(String(e)))
    }

    const ro = new ResizeObserver(settle)
    ro.observe(box)

    return () => {
      ro.disconnect()
      // Handed back, not destroyed: the scrollback belongs to the terminal,
      // not to this view.
      if (element.parentElement === box) box.removeChild(element)
    }
  }, [d.terminalId, cwd, node.id, patch])

  const restart = async () => {
    await terminalClose(d.terminalId).catch(() => {})
    patch(node.id, { running: false })
    if (!cwd) return
    const size = sizeOfTerminal(d.terminalId) ?? { cols: 80, rows: 24 }
    emulatorFor(d.terminalId).term.write('\r\n\x1b[2m[restarting]\x1b[0m\r\n')
    await terminalOpen(d.terminalId, cwd, size.cols, size.rows)
      .then(() => patch(node.id, { running: true, exit: undefined }))
      .catch((e: unknown) => setError(String(e)))
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5">
        <SquareTerminal size={11} className="shrink-0 text-fg-muted" />
        <span className="truncate font-mono text-[11.5px] text-fg">{d.name}</span>
        <span className="min-w-0 truncate font-mono text-[10px] text-fg-faint">
          {cwd ? cwd.replace(/^\/Users\/[^/]+/, '~') : 'no folder'}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={() => void restart()}
            className="rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg-muted"
            title="Restart this shell"
          >
            <RotateCw size={11} />
          </button>
          <button
            onClick={() => {
              void terminalClose(d.terminalId).catch(() => {})
              patch(node.id, { running: false })
            }}
            className="rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg-muted"
            title="End this shell — the terminal stays, and can be restarted"
          >
            <CircleStop size={11} />
          </button>
          {/* An X closes the window it is on. It used to end the shell instead,
              which left the only way out of this panel a small message icon
              that reads as "chat", not "close" — so the terminal looked like
              something you could not get out of. Ending the shell is the stop
              button beside it now. */}
          <button
            onClick={() => setChatTarget(null)}
            className="rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg-muted"
            title="Close this terminal and go back to the conversation"
          >
            <X size={11} />
          </button>
        </span>
      </div>

      {error && (
        <p className="shrink-0 border-b border-line-soft px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {/* Fixed share of the window rather than flexing: the emulator sizes its
          grid to the box it is given, and a box that changes height on every
          line of output would reflow the shell's window with it. */}
      <div ref={host} className="h-[42vh] min-h-0 shrink-0 px-1.5 py-1.5" />
    </>
  )
}
