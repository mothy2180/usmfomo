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

export const CAMPUSES = ['main', 'engineering', 'health', 'other', 'online'] as const
export type Campus = (typeof CAMPUSES)[number]

export const ORG_TYPES = ['club', 'school'] as const
export type OrgType = (typeof ORG_TYPES)[number]

export const BUCKET = 'posters'
