// Test helpers for the owner CLI (imported by *.test.ts only): an in-memory
// CliPort that records every call, account rows and an Io that captures lines.
import type { AccountRow } from '../../supabase/functions/owner-admin/types.ts'
import type { Io } from './commands.ts'
import type { CliPort } from './port.ts'

export const OWNER_ID = '00000000-0000-4000-8000-000000000001'
export const CLUB_ID = '00000000-0000-4000-8000-000000000002'
export const ORG_ID = '00000000-0000-4000-8000-0000000000aa'
export const PASSWORD = 'FakeForTests23456789MNPQ'

export function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    user_id: CLUB_ID,
    username: 'csoc',
    is_owner: false,
    account_active: true,
    org_id: ORG_ID,
    org_name: 'Computer Science Society',
    org_slug: 'csoc',
    org_type: 'club',
    org_campus: 'main',
    org_active: true,
    created_at: '2026-10-01T00:00:00Z',
    last_sign_in_at: '2026-10-05T04:30:00Z',
    banned_until: null,
    factor_count: 1,
    newest_factor_at: '2026-10-02T00:00:00Z',
    live_posts: 3,
    ...overrides,
  }
}

export const OWNER = accountRow({
  user_id: OWNER_ID,
  username: 'owner',
  is_owner: true,
  org_id: null,
  org_name: null,
  org_slug: null,
  org_type: null,
  org_campus: null,
  org_active: null,
  factor_count: 2,
  live_posts: 0,
})
export const CLUB = accountRow()

export type Call = [op: string, ...args: unknown[]]

/** A recording CliPort over an in-memory account list. */
export function fakePort(initial: AccountRow[] = [OWNER, CLUB], overrides: Partial<CliPort> = {}) {
  const accounts = initial.map((a) => ({ ...a }))
  const calls: Call[] = []
  let created = 0
  const defaults: CliPort = {
    verifyToken: () => Promise.reject(new Error('unused')),
    sessionUserId: () => Promise.reject(new Error('unused')),
    isOwner: (id) => Promise.resolve(accounts.some((a) => a.user_id === id && a.is_owner)),
    status: () => Promise.resolve({}),
    listAccounts: () => Promise.resolve(accounts.map((a) => ({ ...a }))),
    authUserExists: () => Promise.resolve(false),
    listFactorIds: () => Promise.resolve(['f1', 'f2']),
    orgObjects: (orgId) => Promise.resolve([`${orgId}/a.webp`, `${orgId}/a-thumb.webp`]),
    createAuthUser: () => Promise.resolve(`00000000-0000-4000-8000-1000000000${String(++created).padStart(2, '0')}`),
    updateAuthUser: () => Promise.resolve(),
    deleteFactor: () => Promise.resolve(),
    deleteAuthUser: () => Promise.resolve(),
    createOrgAccount: (userId, input) => {
      const orgId = `00000000-0000-4000-8000-2000000000${String(created).padStart(2, '0')}`
      accounts.push(accountRow({
        user_id: userId,
        username: input.username,
        org_id: orgId,
        org_name: input.orgName,
        org_slug: input.orgSlug,
        org_type: input.type,
        org_campus: input.campus,
      }))
      return Promise.resolve(orgId)
    },
    setAccountActive: (userId, active) => {
      for (const a of accounts) if (a.user_id === userId) a.account_active = active
      return Promise.resolve()
    },
    updateOrg: () => Promise.resolve(),
    deleteOrg: (orgId) => {
      const i = accounts.findIndex((a) => a.org_id === orgId)
      if (i >= 0) accounts.splice(i, 1)
      return Promise.resolve()
    },
    deletePost: () => Promise.resolve([]),
    removePostImage: () => Promise.resolve([]),
    removeFiles: (paths) => Promise.resolve({ removed: paths.filter((p) => p).length, failed: 0 }),
    linkOwner: (userId, username) => {
      accounts.push({ ...OWNER, user_id: userId, username, factor_count: 0 })
      return Promise.resolve()
    },
  }
  const impl: Record<string, (...args: never[]) => Promise<unknown>> = { ...defaults, ...overrides }
  const recorded: Record<string, unknown> = {}
  for (const [op, fn] of Object.entries(impl)) {
    recorded[op] = (...args: never[]) => {
      calls.push([op, ...args])
      return fn(...args)
    }
  }
  return {
    port: recorded as unknown as CliPort,
    calls,
    accounts,
    /** Operation names in call order, without the read-only listAccounts. */
    writes: () => calls.map(([op]) => op).filter((op) => op !== 'listAccounts'),
  }
}

export function captureIo(): Io & { stdout: string[]; stderr: string[]; all: () => string } {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    all: () => [...stdout, ...stderr].join('\n'),
  }
}
