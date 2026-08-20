import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The emulator's own stylesheet: without it xterm renders its rows stacked
// on top of each other, which looks like a corrupted screen rather than a
// missing import.
import '@xterm/xterm/css/xterm.css'
import './index.css'
import App from './App.tsx'
import { useStore } from './lib/store'

// TEMP-VISUAL-CHECK
;(globalThis as unknown as { __gt: unknown }).__gt = useStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
