/**
 * Switches for work that has replaced something without deleting it.
 *
 * A flag here is a decision that has been made and can still be walked back in
 * one edit — not a setting. Nothing reads these from disk or from the store,
 * because a user who could flip one would be choosing between two versions of
 * the same feature, which is not a choice to offer.
 */

/**
 * The side chat panel in the right dock. Off: the central chatbox replaces it.
 *
 * `ChatPanel.tsx` and everything it uses stays in the build — the chatbox
 * imports its menus and bubbles — so turning this back on restores the docked
 * panel exactly as it was.
 *
 * Annotated `boolean` rather than left to infer `false`: inferred, TypeScript
 * narrows every branch behind it to dead code and the build fails on the
 * unused imports and impossible comparisons that guard the panel — which is
 * the opposite of a switch you can flip back.
 */
export const CHAT_PANEL_ENABLED: boolean = false
