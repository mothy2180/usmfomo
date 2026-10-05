// Input validation for owner-admin. These mirror the rules of
// packages/shared/src/schemas.ts (createAccountSchema) and config.ts, which the
// Edge runtime cannot import (only supabase/functions is deployed); the tests
// in validate_test.ts compare both against the same inputs. The database CHECKs
// in 0010_settings_orgs_accounts.sql remain the authority.
//
// Each helper returns the normalised value, or null when the input is invalid.

export const ACCOUNT_EMAIL_DOMAIN = 'usmfomo.pages.dev'

export const ORG_TYPES = ['club', 'school'] as const
export type OrgType = (typeof ORG_TYPES)[number]

export const CAMPUSES = ['main', 'engineering', 'health', 'other', 'online'] as const
export type Campus = (typeof CAMPUSES)[number]
/** Organisations have a physical home campus (orgs_campus_physical). */
export type OrgCampus = Exclude<Campus, 'online'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/
const NO_CONTROL = /^[^\p{Cc}]*$/u

export function uuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.toLowerCase()
  return UUID_RE.test(v) ? v : null
}

export function username(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return USERNAME_RE.test(v) ? v : null
}

export function orgSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return SLUG_RE.test(v) ? v : null
}

export function orgName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length >= 2 && v.length <= 100 && NO_CONTROL.test(v) ? v : null
}

export function orgType(value: unknown): OrgType | null {
  return (ORG_TYPES as readonly unknown[]).includes(value) ? (value as OrgType) : null
}

export function orgCampus(value: unknown): OrgCampus | null {
  return value !== 'online' && (CAMPUSES as readonly unknown[]).includes(value) ? (value as OrgCampus) : null
}

export function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Same mapping as usernameToEmail in packages/shared/src/supabase.ts. */
export function usernameToEmail(name: string): string {
  return `${name.trim().toLowerCase()}@${ACCOUNT_EMAIL_DOMAIN}`
}
