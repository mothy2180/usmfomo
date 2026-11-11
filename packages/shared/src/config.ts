// Values that must match the database (supabase/migrations). The database is
// the authority; these only let the UI explain limits before a request fails.

/** Logins are usernames; Supabase Auth stores them as synthetic emails on our
 * own hostname. No email is ever sent to these addresses. */
export const ACCOUNT_EMAIL_DOMAIN = 'usmfomo.pages.dev'

export const LIMITS = {
  livePosts: 15,
  newPostsPer24h: 5,
  editsPer24h: 30,
  maxEventDays: 31,
  maxDaysAhead: 365,
  minMinutesLeftOnCreate: 15,
  titleMin: 3,
  titleMax: 100,
  venueMin: 2,
  venueMax: 120,
  descriptionMax: 1000,
  linkMax: 300,
  /** Registration contact email (RFC 5321 path limit). */
  emailMax: 254,
  noticeTitleMax: 120,
  noticeBodyMax: 1000,
  noticeMaxDays: 180,
} as const

export const POSTER = {
  /** Largest original the picker accepts (Module 3: "less than 10 MB"). */
  maxInputBytes: 10 * 1024 * 1024,
  inputTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  /** Re-encoded poster: long edge and size caps (bucket limit is 2 MiB). */
  maxEdge: 1600,
  targetBytes: 350 * 1024,
  maxBytes: 1.5 * 1024 * 1024,
  /** List thumbnails. */
  thumbWidth: 360,
  thumbMaxBytes: 40 * 1024,
  cacheControlSeconds: 3600,
} as const

/**
 * Registration QR image. One file per post, never a thumbnail. It is re-encoded
 * at a high quality on a white background and capped at a modest size, because
 * a QR code must stay sharp enough to scan from a screen.
 */
export const QR = {
  /** Long edge cap; a QR code never needs more, and it is never upscaled. */
  maxEdge: 800,
  /** WebP/JPEG quality ladder (start, floor, step). */
  quality: { start: 0.95, min: 0.8, step: 0.05 },
  targetBytes: 120 * 1024,
  /** Same hard cap as a poster (the bucket allows 2 MiB). */
  maxBytes: 1.5 * 1024 * 1024,
} as const

export const CAMPUSES = ['main', 'engineering', 'health', 'other', 'online'] as const
export type Campus = (typeof CAMPUSES)[number]
/** The campuses students can filter by on the dashboard (no "Other"). */
export const FILTER_CAMPUSES: readonly Campus[] = ['main', 'engineering', 'health', 'online']

export const ORG_TYPES = ['club', 'school'] as const
export type OrgType = (typeof ORG_TYPES)[number]

export const BUCKET = 'posters'
