// Labels for the studio post list. The database decides what the public sees
// (posts_public_read); these only describe it to the club.

export type PostTimeState = 'upcoming' | 'now' | 'ended'
export type PostLabel = 'hidden' | 'cancelled' | PostTimeState
export type LabelTone = 'neutral' | 'sky' | 'danger' | 'ok'

type Timed = { starts_at: string; ends_at: string }
type Flagged = Timed & { hidden_at: string | null; cancelled_at: string | null }

export function postTimeState(post: Timed, now: Date = new Date()): PostTimeState {
  const n = now.getTime()
  if (Date.parse(post.ends_at) <= n) return 'ended'
  if (Date.parse(post.starts_at) <= n) return 'now'
  return 'upcoming'
}

/** Hidden first (it matters most), then Cancelled, then the time state. */
export function postLabels(post: Flagged, now: Date = new Date()): { label: PostLabel; tone: LabelTone }[] {
  const out: { label: PostLabel; tone: LabelTone }[] = []
  if (post.hidden_at) out.push({ label: 'hidden', tone: 'danger' })
  if (post.cancelled_at) out.push({ label: 'cancelled', tone: 'neutral' })
  const time = postTimeState(post, now)
  out.push({ label: time, tone: time === 'now' ? 'ok' : time === 'upcoming' ? 'sky' : 'neutral' })
  return out
}

/** Students can see it (its public page works): not hidden, not over. */
export function isPubliclyVisible(post: Flagged, now: Date = new Date()): boolean {
  return !post.hidden_at && postTimeState(post, now) !== 'ended'
}

/** Ended posts are purged within the hour; editing them is pointless. */
export function isEditable(post: Timed, now: Date = new Date()): boolean {
  return postTimeState(post, now) !== 'ended'
}
