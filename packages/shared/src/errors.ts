// Maps database / Auth / network errors to stable i18n keys ("errors.<key>").
// Trigger errors are SQLSTATE P0001 with a fixed message (see 0020_posts.sql).

export const TRIGGER_ERRORS = [
  'posting_paused',
  'quota_live',
  'quota_daily',
  'quota_edits',
  'end_in_past',
  'start_too_early',
  'start_too_late',
  'too_long',
  'path_invalid',
  'owner_only',
] as const

const CHECK_KEYS: Record<string, string> = {
  posts_title_len: 'title_length',
  posts_title_chars: 'bad_chars',
  posts_venue_len: 'venue_length',
  posts_venue_chars: 'bad_chars',
  posts_description_len: 'description_length',
  posts_description_chars: 'bad_chars',
  posts_link_url: 'link_format',
  posts_time_order: 'end_before_start',
  posts_max_length: 'too_long_event',
  posts_poster_pair: 'poster_pair',
  notices_link_url: 'link_format',
  notices_time_order: 'end_before_start',
  notices_max_length: 'too_long_notice',
}

const AUTH_KEYS: Record<string, string> = {
  invalid_credentials: 'auth_invalid',
  captcha_failed: 'auth_captcha',
  user_banned: 'auth_paused',
  mfa_verification_failed: 'auth_bad_code',
  mfa_challenge_expired: 'auth_bad_code',
  over_request_rate_limit: 'auth_rate_limited',
  over_email_send_rate_limit: 'auth_rate_limited',
  session_not_found: 'session_ended',
  refresh_token_not_found: 'session_ended',
  insufficient_aal: 'mfa_required',
  weak_password: 'weak_password',
}

type MaybeError = {
  code?: unknown
  message?: unknown
  name?: unknown
  status?: unknown
} | null | undefined

/** Returns an i18n key under "errors." for any thrown/returned error. */
export function errorKey(err: unknown): string {
  const e = err as MaybeError
  if (!e) return 'unknown'
  const code = typeof e.code === 'string' ? e.code : undefined
  const message = typeof e.message === 'string' ? e.message : ''

  if (code === 'P0001' && (TRIGGER_ERRORS as readonly string[]).includes(message)) return message
  if (code === 'P0001') return 'unknown'
  if (code === '23514') {
    const m = /check constraint "([a-z_]+)"/.exec(message)
    return (m && CHECK_KEYS[m[1]!]) ?? 'invalid_input'
  }
  if (code === '23505') return 'duplicate'
  if (code === '42501') return 'not_allowed'
  if (code === 'PGRST301' || code === 'PGRST302') return 'session_ended'
  if (code && AUTH_KEYS[code]) return AUTH_KEYS[code]!
  if (/failed to fetch|network|load failed/i.test(message) || e.name === 'TypeError') return 'network'
  if (e.status === 402) return 'service_restricted'
  if (e.status === 429) return 'auth_rate_limited'
  return 'unknown'
}
