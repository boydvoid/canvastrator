import { useEffect, useState } from 'react'

/** Collapsed or not survives a restart — it's a window preference, not state. */
const COLLAPSED_KEY = 'canvastrator.sidebarCollapsed'

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        /* no storage — the sidebar just forgets between launches */
      }
      return !c
    })

  // ⌘\ is the shortcut every mac app with a sidebar uses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  return { collapsed, toggle }
}
