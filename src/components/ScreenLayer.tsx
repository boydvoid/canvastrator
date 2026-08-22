import { createPortal } from 'react-dom'

/**
 * An overlay that belongs to the screen rather than to a canvas.
 *
 * The spawn ring and the command palette are placed in window coordinates —
 * where you double-clicked, the middle of the screen — so they are `fixed`.
 * But every canvas is mounted inside the desk's strip, and the strip slides
 * from one canvas to the next with a `translateX`. A transformed ancestor
 * becomes the containing block for `position: fixed`, so on the second canvas
 * a `fixed inset-0` overlay is laid out against a box one whole screen to the
 * left: the ring opened exactly as asked, off the side of the window, and
 * double-click read as doing nothing at all.
 *
 * Going through `document.body` puts these back outside the transform, where
 * `fixed` means the window again. It changes nothing on the first canvas,
 * whose translate is zero — which is why this only ever showed itself once a
 * second canvas was on the desk.
 */
export const screenLayer = (ui: React.ReactNode) => createPortal(ui, document.body)
