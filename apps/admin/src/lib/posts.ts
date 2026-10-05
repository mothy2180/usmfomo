// Moderation status of a post, as the owner needs to see it. Each post gets
// exactly one status, chosen so every filter is actionable:
//   expired   — ended; the hourly maintenance run will delete it and its files
//   hidden    — hidden by the owner and not ended (Unhide makes it public again)
//   cancelled — public, with a "Cancelled" badge, until it ends
//   live      — public now (or later, before it starts)

export const POST_STATUSES = ['live', 'cancelled', 'hidden', 'expired'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  live: 'Live',
  cancelled: 'Cancelled',
  hidden: 'Hidden',
  expired: 'Expired',
}

type StatusFields = { ends_at: string; hidden_at: string | null; cancelled_at: string | null }

export function postStatus(post: StatusFields, now: Date): PostStatus {
  if (Date.parse(post.ends_at) <= now.getTime()) return 'expired'
  if (post.hidden_at) return 'hidden'
  if (post.cancelled_at) return 'cancelled'
  return 'live'
}

type SearchFields = StatusFields & {
  title: string
  venue: string
  org: { name: string; slug: string } | null
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Case- and accent-insensitive match on title, venue, organisation name or slug. */
export function matchesText(post: SearchFields, q: string): boolean {
  const needle = fold(q.trim())
  if (!needle) return true
  return [post.title, post.venue, post.org?.name ?? '', post.org?.slug ?? ''].some((v) => fold(v).includes(needle))
}

export type PostFilter = { q: string; status: PostStatus | 'all' }

export function filterPosts<T extends SearchFields>(posts: readonly T[], filter: PostFilter, now: Date): T[] {
  return posts.filter(
    (p) => (filter.status === 'all' || postStatus(p, now) === filter.status) && matchesText(p, filter.q),
  )
}

export function countByStatus(posts: readonly StatusFields[], now: Date): Record<PostStatus | 'all', number> {
  const counts = { all: posts.length, live: 0, cancelled: 0, hidden: 0, expired: 0 }
  for (const p of posts) counts[postStatus(p, now)]++
  return counts
}
