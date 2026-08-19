/**
 * How long ago something happened, for a feed you scan rather than read.
 *
 * Coarse on purpose: the bell answers "recently or a while back", and a clock
 * ticking to the second in a dropdown is noise. Anything past a day gets a
 * date, because "9d" stops meaning anything.
 */
export function timeAgo(ts: number, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
