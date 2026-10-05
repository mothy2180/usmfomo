import { describe, expect, it } from 'vitest'
import type { AccountRow } from '../../lib/api.ts'
import {
  INITIAL_CREATE,
  INITIAL_SLUG,
  accountSummary,
  describeOrgChanges,
  hasRecentFactor,
  orgEditValues,
  slugAfterNameChange,
  slugAfterSlugChange,
  slugSuggestion,
  takenErrors,
  validateCreate,
  validateOrgEdit,
} from './accountForms.ts'

const row = (over: Partial<AccountRow> = {}): AccountRow => ({
  user_id: '9f0c2a5e-5b8e-4d55-9a3c-0c1d2e3f4a5b',
  username: 'robotics-club',
  is_owner: false,
  account_active: true,
  org_id: '22222222-2222-4222-8222-222222222222',
  org_name: 'Robotics Club',
  org_slug: 'robotics-club',
  org_type: 'club',
  org_campus: 'engineering',
  org_active: true,
  created_at: '2026-10-01T00:00:00Z',
  last_sign_in_at: null,
  banned_until: null,
  factor_count: 0,
  newest_factor_at: null,
  live_posts: 0,
  ...over,
})

const OWNER = row({
  user_id: 'a0000000-0000-4000-8000-000000000001',
  username: 'owner',
  is_owner: true,
  org_id: null,
  org_name: null,
  org_slug: null,
  org_type: null,
  org_campus: null,
  org_active: null,
})
const ACCOUNTS = [OWNER, row()]

describe('slug suggestion', () => {
  it('follows the organisation name (slugify) until edited', () => {
    let s = slugAfterNameChange(INITIAL_SLUG, 'Persatuan Sains Komputer')
    expect(s).toEqual({ slug: 'persatuan-sains-komputer', follows: true })
    s = slugAfterNameChange(s, 'Kelab Fotografi & Média USM')
    expect(s.slug).toBe('kelab-fotografi-media-usm')
  })

  it('stops following once the slug is edited by hand', () => {
    const edited = slugAfterSlugChange('pskom', 'Persatuan Sains Komputer')
    expect(edited).toEqual({ slug: 'pskom', follows: false })
    expect(slugAfterNameChange(edited, 'Persatuan Sains Komputer USM')).toBe(edited)
    expect(slugSuggestion(edited, 'Persatuan Sains Komputer USM')).toBe('persatuan-sains-komputer-usm')
  })

  it('follows again when cleared or typed back to the suggestion', () => {
    expect(slugAfterSlugChange('', 'Robotics Club').follows).toBe(true)
    expect(slugAfterSlugChange('robotics-club', 'Robotics Club').follows).toBe(true)
    expect(slugSuggestion({ slug: 'robotics-club', follows: true }, 'Robotics Club')).toBeNull()
  })

  it('keeps suggestions inside the database slug rule (≤ 50 chars, no edge hyphens)', () => {
    const long = slugAfterNameChange(INITIAL_SLUG, `${'Very Long Organisation Name '.repeat(4)}!`)
    expect(long.slug.length).toBeLessThanOrEqual(50)
    expect(long.slug).toMatch(/^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/)
    expect(slugAfterNameChange(INITIAL_SLUG, '!!!').slug).toBe('')
  })
})

describe('validateCreate (createAccountSchema)', () => {
  const good = { orgName: '  Kelab Catur ', orgSlug: 'Kelab-Catur', username: ' Catur ', type: 'club' as const, campus: 'main' as const }

  it('normalises valid input', () => {
    expect(validateCreate(good, ACCOUNTS)).toEqual({
      ok: true,
      data: { orgName: 'Kelab Catur', orgSlug: 'kelab-catur', username: 'catur', type: 'club', campus: 'main' },
    })
  })

  it('explains every invalid field, including an unchosen type', () => {
    const result = validateCreate({ ...INITIAL_CREATE, orgName: 'A', orgSlug: '-bad-', username: 'x' }, ACCOUNTS)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.orgName).toBe('This is too short.')
    expect(result.errors.orgSlug).toMatch(/^Use 1–50 characters/)
    expect(result.errors.username).toMatch(/^Use 3–32 characters/)
    expect(result.errors.type).toBe('Choose club or school.')
  })

  it('rejects the online campus for an organisation', () => {
    const result = validateCreate({ ...good, campus: 'online' }, ACCOUNTS)
    expect(result.ok ? null : result.errors.campus).toBe('Choose a physical campus.')
  })

  it('pre-checks names, slugs and usernames already in use (case-insensitive)', () => {
    const result = validateCreate({ ...good, orgName: 'ROBOTICS club', orgSlug: 'robotics-club', username: 'Owner' }, ACCOUNTS)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.orgName).toBe('An organisation with this name already exists.')
    expect(result.errors.orgSlug).toBe('Robotics Club already uses this slug.')
    expect(result.errors.username).toBe('That is the owner’s username.')
  })
})

describe('organisation edit', () => {
  const values = orgEditValues(row())!

  it('starts from the current row', () => {
    expect(values).toEqual({ name: 'Robotics Club', slug: 'robotics-club', type: 'club', campus: 'engineering', active: true })
    expect(orgEditValues(OWNER)).toBeNull()
  })

  it('allows keeping its own name and slug, but not taking another org’s', () => {
    const orgId = row().org_id!
    expect(validateOrgEdit(values, orgId, ACCOUNTS).ok).toBe(true)
    const other = row({ user_id: 'b0000000-0000-4000-8000-000000000002', username: 'chess', org_id: '33333333-3333-4333-8333-333333333333', org_name: 'Chess Club', org_slug: 'chess' })
    const clash = validateOrgEdit({ ...values, slug: 'chess' }, orgId, [...ACCOUNTS, other])
    expect(clash.ok ? null : clash.errors.slug).toBe('Chess Club already uses this slug.')
  })

  it('describes each change, including what deactivating does', () => {
    const result = validateOrgEdit({ ...values, slug: 'robotics', campus: 'main', active: false }, row().org_id!, ACCOUNTS)
    if (!result.ok) throw new Error('expected valid')
    expect(describeOrgChanges(values, result.data)).toEqual([
      'Public link: /o/robotics-club → /o/robotics (the old link stops working)',
      'Campus: Engineering → Main',
      'Inactive: hidden from the public and cannot post',
    ])
    expect(describeOrgChanges(values, { ...values, campus: 'engineering' })).toEqual([])
  })
})

describe('account rows', () => {
  const now = new Date('2026-10-05T06:00:00Z')

  it('flags 2FA devices added in the last 7 days', () => {
    expect(hasRecentFactor(row({ factor_count: 1, newest_factor_at: '2026-09-29T07:00:00Z' }), now)).toBe(true)
    expect(hasRecentFactor(row({ factor_count: 1, newest_factor_at: '2026-09-28T05:00:00Z' }), now)).toBe(false)
    expect(hasRecentFactor(row({ factor_count: 0, newest_factor_at: null }), now)).toBe(false)
  })

  it('summarises paused accounts, inactive orgs and recent devices (owner excluded from counts)', () => {
    const s = accountSummary(
      [
        { ...OWNER, factor_count: 2, newest_factor_at: '2026-10-04T00:00:00Z' },
        row({ account_active: false }),
        row({ user_id: 'c0000000-0000-4000-8000-000000000003', username: 'x-club', org_active: false }),
      ],
      now,
    )
    expect(s.total).toBe(2)
    expect(s.paused).toBe(1)
    expect(s.inactiveOrgs).toBe(1)
    expect(s.recentFactor.map((r) => r.username)).toEqual(['owner'])
  })
})

describe('takenErrors', () => {
  it('ignores the organisation being edited', () => {
    expect(takenErrors({ orgName: 'Robotics Club', orgSlug: 'robotics-club' }, ACCOUNTS, row().org_id!)).toEqual({})
  })
})
