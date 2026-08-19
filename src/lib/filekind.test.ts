import { describe, expect, it } from 'vitest'
import { extensionOf, fileKind, mimeFor, monacoLanguage } from './filekind'

describe('extensionOf', () => {
  it('reads the extension', () => {
    expect(extensionOf('/a/b/main.rs')).toBe('rs')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })

  it('treats a leading dot as part of the name, not an extension', () => {
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('/repo/.env')).toBe('')
  })

  it('is empty for extensionless files', () => {
    expect(extensionOf('Makefile')).toBe('')
  })
})

describe('fileKind', () => {
  it('routes images to the image viewer', () => {
    for (const p of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.avif']) {
      expect(fileKind(p), p).toBe('image')
    }
  })

  it('routes plain text to a text editor rather than a code editor', () => {
    expect(fileKind('notes.txt')).toBe('text')
    expect(fileKind('server.log')).toBe('text')
    expect(fileKind('data.csv')).toBe('text')
  })

  it('routes source files to the code editor', () => {
    expect(fileKind('main.rs')).toBe('code')
    expect(fileKind('App.tsx')).toBe('code')
    expect(fileKind('Dockerfile')).toBe('code')
  })

  it('recognises binaries so we do not render megabytes of noise', () => {
    for (const p of ['lib.dylib', 'a.zip', 'font.woff2', 'clip.mp4', 'app.wasm']) {
      expect(fileKind(p), p).toBe('binary')
    }
  })

  it('treats pdf separately from images', () => {
    expect(fileKind('spec.pdf')).toBe('pdf')
  })

  it('falls back to code for unknown extensions rather than refusing to open', () => {
    expect(fileKind('weird.qqq')).toBe('code')
    expect(fileKind('LICENSE')).toBe('code')
  })
})

describe('monacoLanguage', () => {
  it('maps extensions to monaco ids', () => {
    expect(monacoLanguage('a.ts')).toBe('typescript')
    expect(monacoLanguage('a.tsx')).toBe('typescript')
    expect(monacoLanguage('a.rs')).toBe('rust')
    expect(monacoLanguage('a.yml')).toBe('yaml')
    expect(monacoLanguage('a.toml')).toBe('ini')
  })

  it('maps well-known extensionless files', () => {
    expect(monacoLanguage('Dockerfile')).toBe('dockerfile')
    expect(monacoLanguage('/repo/Makefile')).toBe('makefile')
  })

  it('degrades to plaintext, never undefined', () => {
    expect(monacoLanguage('weird.qqq')).toBe('plaintext')
  })
})

describe('mimeFor', () => {
  it('handles the cases where extension is not the mime subtype', () => {
    expect(mimeFor('a.svg')).toBe('image/svg+xml')
    expect(mimeFor('a.jpg')).toBe('image/jpeg')
    expect(mimeFor('a.pdf')).toBe('application/pdf')
    expect(mimeFor('a.png')).toBe('image/png')
  })
})
