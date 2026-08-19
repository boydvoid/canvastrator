import { Monitor, Moon, Sun } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { THEME_LABEL, useTheme, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'

const ICON: Record<ThemePref, typeof Sun> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
}

const PREFS: ThemePref[] = ['dark', 'light', 'system']

/**
 * Sits with tidy/auto in the canvas header — the same mono-lowercase register,
 * because it's the same kind of thing: a window preference, not app state.
 */
export function ThemeSwitch() {
  const { pref, theme, setPref } = useTheme()
  // Which icon is showing answers "what am I looking at", which the label
  // alone can't when the choice is `system`.
  const Icon = ICON[theme]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="pointer-events-auto -mx-1 flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] text-fg-faint hover:bg-surface hover:text-fg-muted"
          title={`Theme: ${THEME_LABEL[pref]}${pref === 'system' ? ` (${theme})` : ''}`}
        >
          <Icon size={11} />
          {THEME_LABEL[pref]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {PREFS.map((p) => {
          const PrefIcon = ICON[p]
          return (
            <DropdownMenuItem
              key={p}
              onSelect={() => setPref(p)}
              className={cn('justify-between', p === pref && 'text-fg-strong')}
            >
              <span className="flex items-center gap-2">
                <PrefIcon size={12} className="shrink-0" />
                {THEME_LABEL[p]}
              </span>
              {p === pref && <span className="font-mono text-[10px]">●</span>}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
