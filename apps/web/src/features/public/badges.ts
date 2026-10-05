import { isLongEvent, showHappeningNow } from '@usmfomo/shared/time'

export type CardBadge =
  | { kind: 'cancelled' }
  | { kind: 'now' }
  | { kind: 'onUntil'; until: string }
  | { kind: 'updated' }

type BadgeInput = {
  starts_at: string
  ends_at: string
  cancelled_at: string | null
  details_changed_at: string | null
}

/**
 * Which badges a card or event page shows, most important first.
 * - Cancelled replaces everything else (a cancelled event is not "happening").
 * - "Happening now" only for events up to 24 h (showHappeningNow).
 * - Events longer than 24 h say "On until <end day>" instead.
 * - "Updated" when the organiser changed the time or venue (details_changed_at).
 */
export function badgesFor(post: BadgeInput, now: Date = new Date()): CardBadge[] {
  if (post.cancelled_at) return [{ kind: 'cancelled' }]
  const badges: CardBadge[] = []
  if (showHappeningNow(post.starts_at, post.ends_at, now)) badges.push({ kind: 'now' })
  else if (isLongEvent(post.starts_at, post.ends_at)) badges.push({ kind: 'onUntil', until: post.ends_at })
  if (post.details_changed_at) badges.push({ kind: 'updated' })
  return badges
}
