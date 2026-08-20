import { useEffect, useRef } from 'react'
import {
  Bot,
  File,
  Folder,
  GitPullRequestArrow,
  Plug,
  ScrollText,
  SquareTerminal,
} from 'lucide-react'
import { PROVIDER_ACCENT, PROVIDER_LABEL, type Provider } from '@/lib/types'
import { cn } from '@/lib/utils'

export type SpawnKind =
  | 'agent'
  | 'folder'
  | 'file'
  | 'terminal'
  | 'skill'
  | 'mcp'
  | 'landing'

/**
 * The seven things you can put on a canvas, arranged around where you clicked.
 *
 * A ring rather than a list because the gesture it replaces is "I want a thing
 * *here*" — and a menu that drops down and to the right answers "here" with
 * "somewhere below and to the right of here". Every chip is the same distance
 * from the cursor, so no option is cheaper to reach than another, and the node
 * lands exactly where the ring opened.
 *
 * Agent is first, at the top, and drawn in its provider's accent: it is what
 * you are here for nine times out of ten. Choosing a *different* provider is
 * the rarer act and stays in the right-click menu, which has room to name all
 * three and say which are installed.
 */
const RING: { kind: SpawnKind; label: string; Icon: typeof Bot }[] = [
  { kind: 'agent', label: 'Agent', Icon: Bot },
  { kind: 'folder', label: 'Folder', Icon: Folder },
  { kind: 'file', label: 'File', Icon: File },
  { kind: 'terminal', label: 'Terminal', Icon: SquareTerminal },
  { kind: 'skill', label: 'Skill', Icon: ScrollText },
  { kind: 'mcp', label: 'MCP', Icon: Plug },
  { kind: 'landing', label: 'Landing', Icon: GitPullRequestArrow },
]

/**
 * Half-widths of the ellipse the chips sit on.
 *
 * Wider than tall because the chips are: seven of them on a circle would leave
 * the diagonals nearly touching their neighbours, and a menu whose items run
 * together is one you misclick.
 */
const RX = 140
const RY = 96
const CHIP_W = 104
const CHIP_H = 28

export function SpawnRing({
  at,
  provider,
  onPick,
  onClose,
}: {
  /** Where the double-click landed, in screen coordinates. */
  at: { x: number; y: number }
  /** The provider an Agent would use, or null when none is installed. */
  provider: Provider | null
  onPick: (kind: SpawnKind) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Pointer-down rather than click: the ring must be gone before whatever
    // was underneath it reacts, or dismissing it also selects a node.
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      data-shortcuts="off"
      className="pointer-events-none fixed inset-0 z-50"
      style={{ ['--ring-accent' as string]: provider ? PROVIDER_ACCENT[provider] : undefined }}
    >
      {/* Where you clicked, marked, so the ring reads as being *about* a place
          rather than floating over one. */}
      <span
        className="absolute rounded-full border border-line-strong"
        style={{ left: at.x - 26, top: at.y - 26, width: 52, height: 52 }}
      />
      <span
        className="absolute h-2 w-2 rounded-full"
        style={{
          left: at.x - 4,
          top: at.y - 4,
          background: provider ? PROVIDER_ACCENT[provider] : 'var(--color-fg-subtle)',
        }}
      />

      {RING.map(({ kind, label, Icon }, i) => {
        const angle = ((-90 + i * (360 / RING.length)) * Math.PI) / 180
        const isAgent = kind === 'agent'
        const disabled = isAgent && !provider
        return (
          <button
            key={kind}
            disabled={disabled}
            title={
              disabled
                ? 'No agent CLI found on PATH'
                : isAgent && provider
                  ? `New ${PROVIDER_LABEL[provider]} agent`
                  : label
            }
            onClick={() => {
              onPick(kind)
              onClose()
            }}
            style={{
              left: at.x + RX * Math.cos(angle) - CHIP_W / 2,
              top: at.y + RY * Math.sin(angle) - CHIP_H / 2,
              width: CHIP_W,
              height: CHIP_H,
              ...(isAgent && provider ? { borderColor: PROVIDER_ACCENT[provider] } : {}),
            }}
            className={cn(
              'gt-spawn pointer-events-auto absolute flex items-center gap-2 rounded-lg border bg-panel px-2.5 text-left backdrop-blur transition-colors',
              disabled
                ? 'border-line text-fg-faint opacity-50'
                : 'border-line-strong text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <Icon
              size={12}
              className="shrink-0"
              style={isAgent && provider ? { color: PROVIDER_ACCENT[provider] } : undefined}
            />
            <span className="truncate font-mono text-[10.5px]">{label}</span>
          </button>
        )
      })}

      <span
        className="absolute font-mono text-[9px] whitespace-nowrap text-fg-faint"
        style={{ left: at.x - 70, top: at.y + 34, width: 140, textAlign: 'center' }}
      >
        lands where you clicked
      </span>
    </div>
  )
}
