// Test helpers (not imported by index.ts, so never deployed): a recording
// in-memory OwnerAdminPort with sensible defaults that each test overrides.
import type { AccountRow, OwnerAdminPort } from './types.ts'

export const OWNER_ID = '00000000-0000-4000-8000-000000000001'
export const CLUB_ID = '00000000-0000-4000-8000-000000000002'
export const NEW_USER_ID = '00000000-0000-4000-8000-000000000003'
export const ORG_ID = '00000000-0000-4000-8000-0000000000aa'
export const NEW_ORG_ID = '00000000-0000-4000-8000-0000000000bb'
export const POST_ID = '00000000-0000-4000-8000-0000000000cc'
export const ALLOWED_ORIGIN = 'http://127.0.0.1:5174'
/** Shape-valid fake JWT (header.payload.signature); the fake port decides what it means. */
export const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.FakeForTests'

export function account(overrides: Partial<AccountRow>): AccountRow {
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
    created_at: '2026-10-05T00:00:00Z',
    last_sign_in_at: null,
    banned_until: null,
    factor_count: 0,
    newest_factor_at: null,
    live_posts: 0,
    ...overrides,
  }
}

export const OWNER_ROW = account({
  user_id: OWNER_ID,
  username: 'owner',
  is_owner: true,
  org_id: null,
  org_name: null,
  org_slug: null,
  org_type: null,
  org_campus: null,
  org_active: null,
})
export const CLUB_ROW = account({})

export type Call = { op: string; args: unknown[] }

export function fakePort(overrides: Partial<OwnerAdminPort> = {}) {
  const defaults: OwnerAdminPort = {
    verifyToken: () => Promise.resolve({ sub: OWNER_ID, role: 'authenticated', aal: 'aal2' }),
    sessionUserId: () => Promise.resolve(OWNER_ID),
    isOwner: (id) => Promise.resolve(id === OWNER_ID),
    status: () => Promise.resolve({ live_posts: 3 }),
    listAccounts: () => Promise.resolve([OWNER_ROW, CLUB_ROW]),
    getAccount: (id) => Promise.resolve([OWNER_ROW, CLUB_ROW].find((a) => a.user_id === id) ?? null),
    authUserExists: () => Promise.resolve(false),
    listFactorIds: () => Promise.resolve(['f1', 'f2']),
    orgObjects: () => Promise.resolve([`${ORG_ID}/a.webp`, `${ORG_ID}/a-thumb.webp`]),
    createAuthUser: () => Promise.resolve(NEW_USER_ID),
    allowPasswordChange: () => Promise.resolve(),
    updateAuthUser: () => Promise.resolve(),
    deleteFactor: () => Promise.resolve(),
    deleteAuthUser: () => Promise.resolve(),
    createOrgAccount: () => Promise.resolve(NEW_ORG_ID),
    setAccountActive: () => Promise.resolve(),
    updateOrg: () => Promise.resolve(),
    deleteOrg: () => Promise.resolve(),
    deletePost: () => Promise.resolve([{ poster_path: `${ORG_ID}/p.webp`, thumb_path: `${ORG_ID}/p-thumb.webp` }]),
    removePostImage: () => Promise.resolve([{ poster_path: `${ORG_ID}/p.webp`, thumb_path: `${ORG_ID}/p-thumb.webp` }]),
    removeFiles: (paths) => Promise.resolve({ removed: paths.filter((p) => p).length, failed: 0 }),
  }
  const impl: Record<string, (...args: never[]) => Promise<unknown>> = { ...defaults, ...overrides }
  const calls: Call[] = []
  const recorded: Record<string, unknown> = {}
  for (const [op, fn] of Object.entries(impl)) {
    recorded[op] = (...args: never[]) => {
      calls.push({ op, args })
      return fn(...args)
    }
  }
  return {
    port: recorded as unknown as OwnerAdminPort,
    calls,
    ops: () => calls.map((c) => c.op),
  }
}

/** Captures console.log/console.error output while `fn` runs. */
export async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const lines: string[] = []
  const { log, error } = console
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  try {
    return { result: await fn(), logs: lines.join('\n') }
  } finally {
    console.log = log
    console.error = error
  }
}
