/**
 * A short chime when the canvas goes quiet.
 *
 * Synthesized rather than shipped as a file: it's two sine tones, and a bundled
 * asset would need loading, decoding and a licence for something this small.
 */

let ctx: AudioContext | null = null

/** Two notes a fifth apart, quiet and quick — a full stop, not an alarm. */
export function playDone() {
  try {
    ctx ??= new AudioContext()
    // Browsers suspend audio contexts created before a gesture.
    if (ctx.state === 'suspended') void ctx.resume()

    const now = ctx.currentTime
    for (const [i, freq] of [660, 990].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq

      const at = now + i * 0.09
      // Ramped, never switched: a square-edged gain change clicks.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.05, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28)

      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.3)
    }
  } catch {
    // No audio device, or a context the OS won't grant. Silence is fine.
  }
}

/**
 * True when the canvas has just gone from working to idle.
 *
 * Only the transition matters: a canvas that was already quiet shouldn't chime
 * every time anything else changes, and one agent finishing while others work
 * isn't done — the point is knowing you can look away until everything stops.
 */
export function justWentQuiet(wasBusy: boolean, isBusy: boolean): boolean {
  return wasBusy && !isBusy
}
