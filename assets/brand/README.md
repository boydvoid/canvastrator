# Canvastrator brand

`assets/brand/` is the **source of truth**. Everything in `public/` and
`src-tauri/icons/` is a copy or a build product of what lives here — edit the
source, then re-sync (see *Regenerating*).

## The concept

**The C is the canvas.**

A 5x5 field of canvas cells. Eleven of them are occupied, and those eleven
*are* the letter — there is no C drawn and no grid drawn behind it, only cells
that are present and cells that are absent.

That is the product stated as geometry. Canvastrator is not a tiling terminal;
it is a canvas where agent sessions, files, skills and personalities are nodes
you place and wire together. The grid is therefore not decoration behind the
mark, it is the substrate the mark is made of, and the letterform is nothing
but an arrangement of occupied slots.

Occupancy (`.` absent, `X` present):

```
. X X X X
X . . . .
X . . . .
X . . . .
. X X X X
```

Two decisions carry the whole figure. The **left corner cells are absent**,
which puts a diagonal step at each left corner — a full-width bar reads as
`[`, this reads as `C`. And the **right side is open across three whole
cells**, 16 of the 24 units, so the aperture can never close into an `O` at
small sizes.

## Geometry

One 32-unit grid, flat fills, no strokes, no gradients, no filters.

- **Pitch 5, module 4, gutter 1, origin 4.** Column and row origins land on
  4, 9, 14, 19, 24; the modules span 4-8, 9-13, 14-18, 19-23, 24-28.
- Module corner radius is **1** — a quarter of the module. Enough to read as
  a rounded cell rather than a pixel, not enough to read as a dot.
- Painted bounds are 4..28 on both axes: a 24-unit mark in a 32-unit box.
  This is the same envelope the previous mark used, so the wordmark lockup
  and the `icon.svg` transform take it without re-spacing.

**Why the gutter is 1 and not 2.** The gutter is deliberately narrower than a
device pixel at the smallest size, so the mark degrades in the right
direction:

| render | gutter | reads as |
| --- | --- | --- |
| 16 px | 0.5 px | gutters anti-alias shut — a solid, unambiguous C |
| 32 px | 1 px | the grid snaps into view |
| 128 px | 4 px | the construction is plain |

The *silhouette* is what has to stay crisp, and it does: the outer bounds, 4
and 28, are whole pixels at every power-of-two size. The grid detail is the
part that is allowed to fade. A 4-and-2 rhythm was drawn first and is too
sparse — it reads as a ring of beads at 128 px rather than a letter.

A one-cell aperture (the classic 5x5 bitmap `C`, with terminals curling back
at the top and bottom right) was also drawn and tested, and rejected: at
16 px it reads as a ring, not a C.

The mark has **no stroke anywhere** — it is eleven filled rects. There is
nothing whose weight can scale wrong when the rasteriser hands it to `.ico`
or `.icns`.

Keep **one cell (5 units) of clear space** on all four sides. The mark already
carries 4 of that inside its own 32-unit box.

## Files

| File | Canvas | What it is |
| --- | --- | --- |
| `logo.svg` | 32 | Primary mark, ink-100, for dark grounds |
| `logo-on-light.svg` | 32 | Same mark in ink-950, for light grounds |
| `logo-mono.svg` | 32 | Single flat `currentColor` fill — see the caveat below |
| `logo-wordmark.svg` | 156×32 | Horizontal lockup: mark + `Canvastrator` + cursor |
| `logo-wordmark-on-light.svg` | 156×32 | Lockup in ink-950 |
| `logo-wordmark-mono.svg` | 156×32 | Lockup in `currentColor` |
| `icon.svg` | 1024 | App icon — source for `tauri icon` |
| `icon-mono.svg` | 1024 | Template icon for the macOS menu bar / tray |
| `favicon.svg` | 32 | Full-bleed small-size variant, auto light/dark |

## The wordmark is drawn, not set

The lettering is **pure geometry** — straight segments and exact arcs. No font
is referenced and no `<text>` is used, so the lockup rasterises identically on
every machine with no webfont to ship and nothing to go missing in print or on
a build box.

Metrics (path coordinates; the 2-wide stroke adds 1 all round):

| | path | painted |
| --- | --- | --- |
| baseline | y = 22 | y = 23 |
| cap height | y = 10..22 | 9..23 |
| x-height | y = 14..22 | 13..23 |
| glyph box | 8 wide | 10 wide, **advance 14** |

The fixed 14-unit pitch is deliberate: the wordmark is set monospaced, because
the app is a client for monospaced things.

Every arc endpoint sits on an axis extreme of its own circle or ellipse, so no
renderer ever has to auto-scale a radius. One trap worth knowing if you redraw
the `d`: its bowl is `A8 4`, not `A4 4`. The chord `(9,14)–(9,22)` *is* the
ry-diameter, so `rx` alone controls how far left the bowl reaches — an `rx` of
4 silently collapses it to half width and the `d` reads as `ol`.

## Colour

Tokens resolved from `src/index.css`:

| Token | Hex | Used for |
| --- | --- | --- |
| `--color-ink-100` | `#e6e8eb` | the mark on dark |
| `--color-ink-950` | `#090b0f` | the mark on light |
| `--color-ink-900` | `#121418` | icon container body |
| `--color-ink-800` | `#21242a` | icon container rim |

The mark is complete in **one flat colour** and ships that way everywhere.
Tinting a single cell with a provider accent (`--color-claude`,
`--color-codex`, `--color-opencode`) or `--color-live` to stand for a running
agent is an option, never a requirement — and if you do it, tint exactly one
cell. Never colour the arms differently from the stem.

> **`currentColor` caveat.** `logo-mono.svg` only inherits `color` when it is
> **inlined** in the DOM or used as a CSS `mask`. Loaded through `<img src>`
> it is a separate document and cannot see the page's `color` — it will fall
> back to black. Use `logo.svg` / `logo-on-light.svg` for `<img>`.

## The app icon

`icon.svg` is built on Apple's optical grid: a 1024 canvas with the icon body
as an **824×824 rounded square inset 100 on every side, corner radius 185**.
That padding is what makes Canvastrator sit at the same visual size as system apps
in the Dock rather than looming over them. The mark fills 480 of the 824 body
(58%) — the standard optical fill for a geometric mark in a container.

The body is `ink-900` with an 8-unit `ink-800` rim, **not** `ink-950`. Filling
it with the app's own backdrop value was tried first and the icon lost its
silhouette against a black Dock or dark wallpaper — body and ground were the
same value. Lifting one step and adding the rim gives the shape a
self-contained edge on any wallpaper without resorting to a gradient, bevel or
drop shadow.

## Minimum sizes

- **Mark:** 16 px. Verified by rasterising at 16/20/24/32 and inspecting the
  pixels, not by eyeballing it at 128. At 16 px the gutters close and the
  figure resolves to a solid C; that is by design, not a failure.
- **Lockup:** 150 px wide (156x32 aspect). Under that, drop the word and use
  the mark alone.
- **`icon.svg`:** 32 px. At 16 px the container padding eats too many pixels —
  that is exactly what `favicon.svg` (full bleed) and `icon-mono.svg`
  (no container) exist for. Do not shrink `icon.svg` into a menu bar.

Prefer the power-of-two sizes; the grid is tuned for them.

## Regenerating

**Platform icons** (macOS `.icns`, Windows `.ico`, all PNGs, plus the iOS and
Android sets) — `tauri icon` reads the SVG directly, no pre-rasterising:

```sh
bunx tauri icon assets/brand/icon.svg
```

This writes `src-tauri/icons/`. The `bundle.icon` array in
`src-tauri/tauri.conf.json` already lists the canonical five outputs
(`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`), so it
needs no edit after a regeneration.

**Web assets** — `public/` is served at the web root, so it holds copies:

```sh
cp assets/brand/favicon.svg assets/brand/logo.svg assets/brand/logo-wordmark.svg public/
sips -z 180 180 src-tauri/icons/icon.png --out public/apple-touch-icon.png
```

`index.html` references `/favicon.svg` and `/apple-touch-icon.png`.

## Don'ts

Don't rotate the mark. Don't close the aperture or add terminals to it — the
open right side is what keeps it a C and not an O. Don't widen the gutter into
a visible gap at small sizes. Don't fill the empty cells, even faintly: the
absent cells are absent, not a background grid. Don't stack the lockup
vertically. Don't re-set the wordmark in a real font — the drawn one is the
wordmark. Don't add a gradient, bevel or shadow to the icon. Don't sit the
mark on a busy background.

## Known gap

The wordmark lockups still spell **GridTerm** — the lettering is drawn
geometry from before the rename, and the eight glyphs would have to be redrawn
as twelve (`Canvastrator`, same 14-unit pitch, taking the lockup to roughly
216 units wide) to say the current product name. The `aria-label` on those
files already reads Canvastrator, so the accessible name is right and the drawn
one is not. The mark itself is current everywhere.
