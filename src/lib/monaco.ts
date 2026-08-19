/**
 * Monaco, self-hosted. The default @monaco-editor/react loader pulls the
 * editor from a CDN, which a Tauri webview has no business doing — offline
 * and CSP-hostile. This wires the bundled copy and its workers instead.
 *
 * Worker paths omit the `esm/vs/` prefix on purpose: monaco's exports map is
 * `"./*": "./esm/vs/*.js"`, so including it resolves to `esm/vs/esm/vs/…`.
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'
import { subscribeTheme, type Theme } from './theme'

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

/**
 * Matches the canvas palette so the editor doesn't look bolted on. Monaco owns
 * its own colour registry and can't read CSS variables, so these are the light
 * and dark palettes written out again in the only form it accepts.
 */
monaco.editor.defineTheme('canvastrator', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#16181d',
    'editorGutter.background': '#16181d',
    'editor.lineHighlightBackground': '#1c1f26',
    'editorLineNumber.foreground': '#454b58',
    'editorLineNumber.activeForeground': '#8b93a3',
    'editorIndentGuide.background1': '#232730',
    'editorWidget.background': '#1c1f26',
    'editorWidget.border': '#2b303a',
    'input.background': '#101216',
    'dropdown.background': '#1c1f26',
    'scrollbarSlider.background': '#2b303a80',
  },
})

monaco.editor.defineTheme('canvastrator-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#f2f3f6',
    'editorGutter.background': '#f2f3f6',
    'editor.lineHighlightBackground': '#ebedf0',
    'editorLineNumber.foreground': '#8f939a',
    'editorLineNumber.activeForeground': '#3f4249',
    'editorIndentGuide.background1': '#dcdee2',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d7d9dd',
    'input.background': '#ffffff',
    'dropdown.background': '#ffffff',
    'scrollbarSlider.background': '#c1c4c980',
  },
})

export const monacoTheme = (theme: Theme) => (theme === 'light' ? 'canvastrator-light' : 'canvastrator')

// Chat code blocks are tokenized with `monaco.editor.colorize`, which reads the
// global theme rather than any editor's — so the theme has to be set even when
// no file is open.
subscribeTheme((theme) => monaco.editor.setTheme(monacoTheme(theme)))

loader.config({ monaco })

export { monaco }
