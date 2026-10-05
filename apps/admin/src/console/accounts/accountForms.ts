// Form logic for creating accounts and editing organisations. The rules come
// from @usmfomo/shared (createAccountSchema, which mirrors the database
// CHECKs); this module only adds UI behaviour: the slug suggestion, friendly
// messages and a duplicate pre-check against the loaded list. The server and
// the database stay the authority.
import { type Campus, type OrgType } from '@usmfomo/shared/config'
import { createAccountSchema, slugify, type CreateAccountInput } from '@usmfomo/shared/schemas'
import type { AccountRow } from '../../lib/api.ts'
import { isWithinDays } from '../../lib/format.ts'
import { fieldErrors, type Validated } from '../../lib/forms.ts'
import { CAMPUS_LABELS, TYPE_LABELS } from '../../lib/labels.ts'
import { z } from '../../lib/zod.ts'

// ---------------------------------------------------------------------------
// Slug suggestion: follows the organisation name until edited by hand.
// ---------------------------------------------------------------------------

export type SlugState = { slug: string; follows: boolean }

export const INITIAL_SLUG: SlugState = { slug: '', follows: true }

/** The organisation name changed: a following slug becomes the new suggestion. */
export function slugAfterNameChange(state: SlugState, name: string): SlugState {
  return state.follows ? { slug: slugify(name), follows: true } : state
}

/** The slug was edited: it stops following, unless cleared or typed back to the suggestion. */
export function slugAfterSlugChange(slug: string, name: string): SlugState {
  return { slug, follows: slug.trim() === '' || slug === slugify(name) }
}

/** A suggestion worth offering as a one-click fix (the owner typed something else). */
export function slugSuggestion(state: SlugState, name: string): string | null {
  const suggestion = slugify(name)
  return !state.follows && suggestion && suggestion !== state.slug ? suggestion : null
}

// ---------------------------------------------------------------------------
// Duplicate pre-check (usernames, org slugs and org names are unique).
// ---------------------------------------------------------------------------

type Existing = Pick<AccountRow, 'username' | 'is_owner' | 'org_id' | 'org_name' | 'org_slug'>

export type Taken = { username?: string; orgName?: string; orgSlug?: string }

const folded = (s: string) => s.trim().toLowerCase()

/** Messages for values another account or organisation already uses. */
export function takenErrors(
  input: { username?: string; orgName: string; orgSlug: string },
  accounts: readonly Existing[],
  exceptOrgId?: string,
): Taken {
  const out: Taken = {}
  for (const a of accounts) {
    if (input.username !== undefined && !out.username && a.username === folded(input.username)) {
      out.username = a.is_owner ? 'That is the owner’s username.' : `${a.org_name ?? 'Another account'} already uses this username.`
    }
    if (a.org_id === null || a.org_id === exceptOrgId) continue
    if (!out.orgSlug && a.org_slug === folded(input.orgSlug)) {
      out.orgSlug = `${a.org_name ?? 'Another organisation'} already uses this slug.`
    }
    if (!out.orgName && a.org_name !== null && folded(a.org_name) === folded(input.orgName)) {
      out.orgName = 'An organisation with this name already exists.'
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Create account.
// ---------------------------------------------------------------------------

export type CreateValues = {
  orgName: string
  orgSlug: string
  username: string
  type: OrgType | ''
  campus: Campus
}

/** Form order, for focusing the first invalid field. */
export const CREATE_FIELDS = ['orgName', 'orgSlug', 'username', 'type', 'campus'] as const

export const INITIAL_CREATE: CreateValues = { orgName: '', orgSlug: '', username: '', type: '', campus: 'main' }

export function validateCreate(values: CreateValues, accounts: readonly Existing[]): Validated<CreateAccountInput> {
  const parsed = createAccountSchema.safeParse(values)
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error.issues)
    if (values.type === '') errors.type = 'Choose club or school.'
    return { ok: false, errors }
  }
  const taken = takenErrors(parsed.data, accounts)
  if (taken.username || taken.orgName || taken.orgSlug) return { ok: false, errors: { ...taken } }
  return { ok: true, data: parsed.data }
}

// ---------------------------------------------------------------------------
// Edit organisation (admin_update_org). Same field rules as account creation.
// ---------------------------------------------------------------------------

const shape = createAccountSchema.shape

export const orgEditSchema = z.object({
  name: shape.orgName,
  slug: shape.orgSlug,
  type: shape.type,
  campus: shape.campus,
  active: z.boolean(),
})

export type OrgEditValues = { name: string; slug: string; type: OrgType; campus: Campus; active: boolean }
export type OrgEditOutput = z.output<typeof orgEditSchema>

export const ORG_EDIT_FIELDS = ['name', 'slug', 'type', 'campus', 'active'] as const

export function orgEditValues(row: AccountRow): OrgEditValues | null {
  if (!row.org_id || row.org_name === null || row.org_slug === null || !row.org_type || !row.org_campus) return null
  return { name: row.org_name, slug: row.org_slug, type: row.org_type, campus: row.org_campus, active: row.org_active ?? true }
}

export function validateOrgEdit(
  values: OrgEditValues,
  orgId: string,
  accounts: readonly Existing[],
): Validated<OrgEditOutput> {
  const parsed = orgEditSchema.safeParse(values)
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error.issues) }
  const taken = takenErrors({ orgName: parsed.data.name, orgSlug: parsed.data.slug }, accounts, orgId)
  if (taken.orgName || taken.orgSlug) return { ok: false, errors: { name: taken.orgName, slug: taken.orgSlug } }
  return { ok: true, data: parsed.data }
}

/** What an edit changes, in words, so the owner can check before saving. */
export function describeOrgChanges(before: OrgEditValues, after: OrgEditOutput): string[] {
  const out: string[] = []
  if (after.name !== before.name) out.push(`Name: “${before.name}” → “${after.name}”`)
  if (after.slug !== before.slug) out.push(`Public link: /o/${before.slug} → /o/${after.slug} (the old link stops working)`)
  if (after.type !== before.type) out.push(`Type: ${TYPE_LABELS[before.type]} → ${TYPE_LABELS[after.type]}`)
  if (after.campus !== before.campus) out.push(`Campus: ${CAMPUS_LABELS[before.campus]} → ${CAMPUS_LABELS[after.campus]}`)
  if (after.active !== before.active) {
    out.push(after.active ? 'Active again: listed publicly and can post' : 'Inactive: hidden from the public and cannot post')
  }
  return out
}

// ---------------------------------------------------------------------------
// Row display.
// ---------------------------------------------------------------------------

/** 2FA devices added recently deserve a look: was it the club, or someone with a stolen password? */
export const RECENT_FACTOR_DAYS = 7

export function hasRecentFactor(row: Pick<AccountRow, 'factor_count' | 'newest_factor_at'>, now: Date): boolean {
  return row.factor_count > 0 && isWithinDays(row.newest_factor_at, RECENT_FACTOR_DAYS, now)
}

export function accountSummary(rows: readonly AccountRow[], now: Date) {
  const orgAccounts = rows.filter((r) => !r.is_owner)
  return {
    total: orgAccounts.length,
    paused: orgAccounts.filter((r) => !r.account_active).length,
    inactiveOrgs: orgAccounts.filter((r) => r.org_active === false).length,
    recentFactor: rows.filter((r) => hasRecentFactor(r, now)),
  }
}
