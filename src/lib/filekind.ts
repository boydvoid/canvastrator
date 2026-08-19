/** How a file should be opened. */
export type FileKind = 'image' | 'code' | 'text' | 'pdf' | 'binary'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'])

/** Extensions that get plain textarea treatment rather than a code editor. */
const PLAIN = new Set(['txt', 'log', 'text', 'csv', 'tsv'])

const BINARY = new Set([
  'zip', 'gz', 'tar', 'bz2', 'xz', '7z', 'rar',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'mov', 'avi', 'wav', 'flac', 'webm', 'mkv',
  'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'o', 'a',
  'db', 'sqlite', 'sqlite3',
])

/** Extension → Monaco language id. Only where they differ from the extension. */
const LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  jsonc: 'json',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  xml: 'xml',
  svg: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  dart: 'dart',
  vue: 'html',
  proto: 'protobuf',
}

/** Files with no extension that are still code. */
const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  brewfile: 'ruby',
  procfile: 'yaml',
  '.gitignore': 'plaintext',
  '.env': 'ini',
}

export const extensionOf = (path: string) => {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  // A leading dot is part of the name (.gitignore), not an extension.
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function fileKind(path: string): FileKind {
  const ext = extensionOf(path)
  const name = (path.split('/').pop() ?? path).toLowerCase()

  if (IMAGE.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (BINARY.has(ext)) return 'binary'
  if (PLAIN.has(ext)) return 'text'
  if (ext && LANGUAGE[ext]) return 'code'
  if (BY_NAME[name]) return 'code'
  // No extension, or one we don't know: treat as code so it's still readable
  // and syntax-neutral, rather than refusing to show it.
  return 'code'
}

export function monacoLanguage(path: string): string {
  const ext = extensionOf(path)
  const name = (path.split('/').pop() ?? path).toLowerCase()
  return LANGUAGE[ext] ?? BY_NAME[name] ?? 'plaintext'
}

export const mimeFor = (path: string) => {
  const ext = extensionOf(path)
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'jpg') return 'image/jpeg'
  if (ext === 'pdf') return 'application/pdf'
  return `image/${ext}`
}
