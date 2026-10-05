// Every error the console can show, in plain English (the owner is the only
// user, so the console is English-only). Database and Auth errors go through
// errorKey() from @usmfomo/shared so they match the public site's mapping.
import { errorKey } from '@usmfomo/shared/errors'
import { AdminApiError, type AdminAction, type AdminErrorCode } from './api.ts'

/** A PostgREST write that matched no row: RLS hid it (owner session ended?) or it is gone. */
export class NoRowsError extends Error {
  constructor() {
    super('no_rows')
    this.name = 'NoRowsError'
  }
}

const ADMIN: Record<AdminErrorCode, string> = {
  bad_request: 'The server rejected the request. Check the details and try again.',
  unauthorized: 'Your session has ended. Sign in again.',
  forbidden: 'This account is not allowed to do that.',
  mfa_required: 'This needs a two-factor (aal2) session. Sign in again with your authenticator code.',
  not_found: 'Not found. It may already have been deleted; refresh the list.',
  conflict: 'That conflicts with existing data.',
  internal: 'The owner-admin function hit an error. Try again; if it repeats, check the function logs.',
  network:
    "Couldn't reach the server. Check your connection. The action may or may not have happened, so refresh before trying again.",
  unavailable: 'The owner-admin function is unavailable (not deployed, renamed or down).',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  service_restricted: 'Supabase is restricting this project (a quota was exceeded). Check the Supabase dashboard.',
  bad_response: 'The owner-admin function sent an unexpected response.',
  unknown: 'Something went wrong. Try again.',
}

const BY_ACTION: Partial<Record<AdminAction, Partial<Record<AdminErrorCode, string>>>> = {
  create_account: {
    conflict: 'That username, organisation name or slug is already taken.',
    bad_request: 'The server rejected these details. Check the username, organisation name, slug and campus.',
    bad_response:
      "The account was probably created, but the server didn't return its password. Check the list, then reset its password.",
  },
  update_org: {
    conflict: 'Another organisation already uses that name or slug.',
    not_found: 'This organisation no longer exists. Refresh the list.',
  },
  delete_account: {
    forbidden: "The owner account can't be deleted from the console.",
    bad_request: "This account can't be deleted from the console.",
  },
  reset_password: {
    bad_response: "The password was probably changed, but the server didn't return it. Reset it again to get a new one.",
  },
  handover: {
    bad_response: "The handover probably ran, but the server didn't return the new password. Reset the password to get one.",
  },
}

/** Keys produced by errorKey() (packages/shared/src/errors.ts). */
const DB: Record<string, string> = {
  not_allowed: 'Not allowed. Your owner session may have ended; sign in again.',
  session_ended: 'Your session has ended. Sign in again.',
  mfa_required: 'This needs a two-factor (aal2) session. Sign in again with your authenticator code.',
  network: "Couldn't reach the server. Check your connection and try again.",
  service_restricted: 'Supabase is restricting this project (a quota was exceeded). Check the Supabase dashboard.',
  duplicate: 'That already exists.',
  invalid_input: 'Some details are not valid. Check the form.',
  bad_chars: 'Remove tabs and other invisible control characters.',
  link_format: 'Links must start with https:// and contain no spaces or user@ part.',
  end_before_start: 'The end must be after the start.',
  too_long_notice: 'A notice can be shown for at most 180 days.',
  too_long_event: 'An event can last at most 31 days.',
  title_length: 'The title has the wrong length.',
  venue_length: 'The venue has the wrong length.',
  description_length: 'The description is too long.',
  poster_pair: 'A poster and its thumbnail must be set or removed together.',
  owner_only: 'Only the owner can hide or unhide posts. Sign in again.',
  posting_paused: 'Posting is paused.',
  end_in_past: 'The end time is in the past.',
  start_too_early: 'The start time is too far in the past.',
  start_too_late: 'The start time is too far in the future.',
  too_long: 'A post can never run more than 400 days after it was created.',
  path_invalid: 'The poster path is not valid.',
  quota_live: 'This organisation already has 15 live posts.',
  quota_daily: 'This organisation reached its daily post limit.',
  quota_edits: 'This organisation reached its daily edit limit.',
  auth_invalid: 'Wrong username or password.',
  auth_captcha: 'The security check failed or expired. Complete it again.',
  auth_paused: 'This account is paused.',
  auth_bad_code: "That code didn't work. Codes change every 30 seconds; check the device and try again.",
  auth_rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  weak_password: 'That password is too weak.',
  unknown: 'Something went wrong. Try again.',
}

/** Auth codes that errorKey() does not know but the TOTP screens can hit. */
const MFA: Record<string, string> = {
  mfa_factor_name_conflict: 'You already have a device with that name. Choose another name.',
  too_many_enrolled_mfa_factors: 'Too many devices are enrolled on this account.',
  mfa_factor_not_found: 'That device is no longer enrolled. Start again.',
  mfa_totp_enroll_not_enabled: 'TOTP enrolment is turned off in Supabase Auth.',
  mfa_totp_verify_not_enabled: 'TOTP verification is turned off in Supabase Auth.',
  mfa_ip_address_mismatch: 'Your network address changed during setup. Start again.',
}

export function errorMessage(err: unknown): string {
  if (err instanceof AdminApiError) {
    const text = BY_ACTION[err.action]?.[err.code] ?? ADMIN[err.code]
    return err.serverCode ? `${text} (${err.serverCode})` : text
  }
  if (err instanceof NoRowsError) {
    return 'Nothing changed: the item is gone, or your owner session has ended. Refresh, or sign in again.'
  }
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  if (typeof code === 'string' && MFA[code]) return MFA[code]
  return DB[errorKey(err)] ?? DB.unknown!
}
