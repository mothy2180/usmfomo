import { describe, expect, it, vi } from 'vitest'

// session.ts imports the real client; tests only need the pure functions.
vi.mock('./db.ts', () => ({ studioDb: {} }))

const { accessKey, decideStudioAccess, keepSameUser, needsSecondFactor, parsePostingStatus, tokenClaims } = await import('./session.ts')

const SESSION = { access_token: 'x' }
const AAL1_ONLY = { currentLevel: 'aal1', nextLevel: 'aal1' }
const AAL1_NEEDS_2 = { currentLevel: 'aal1', nextLevel: 'aal2' }
const AAL2 = { currentLevel: 'aal2', nextLevel: 'aal2' }

const okJson = {
  state: 'ok',
  username: 'robotik',
  org: { id: '11111111-1111-4111-8111-111111111111', name: 'Kelab Robotik', slug: 'robotik', type: 'club', campus: 'main' },
  posting_enabled: true,
  live: 12,
  live_limit: 15,
  new_24h: 3,
  new_limit: 5,
  next_slot_at: null,
  edits_24h: 4,
  edits_limit: 30,
  factors: 2,
}

describe('decideStudioAccess', () => {
  it('sends visitors without a session to the login page', () => {
    expect(decideStudioAccess(null, null, null)).toBe('login')
    expect(decideStudioAccess(null, AAL2, { state: 'ok' })).toBe('login')
  })

  it('lets a club in when the database says ok', () => {
    expect(decideStudioAccess(SESSION, AAL1_ONLY, { state: 'ok' })).toBe('ok')
    expect(decideStudioAccess(SESSION, AAL2, { state: 'ok' })).toBe('ok')
  })

  it('asks for the code when a factor exists but the session is aal1', () => {
    expect(decideStudioAccess(SESSION, AAL1_NEEDS_2, { state: 'mfa_required' })).toBe('mfa')
    // A committee member added a factor elsewhere: this session's cached user
    // still says aal1/aal1, but the database knows better.
    expect(decideStudioAccess(SESSION, AAL1_ONLY, { state: 'mfa_required' })).toBe('mfa')
    // Client-side AAL alone is enough to ask for the code.
    expect(decideStudioAccess(SESSION, AAL1_NEEDS_2, { state: 'ok' })).toBe('mfa')
  })

  it('keeps the owner out of the studio, even before the code', () => {
    expect(decideStudioAccess(SESSION, AAL1_NEEDS_2, { state: 'owner' })).toBe('owner')
    expect(decideStudioAccess(SESSION, AAL2, { state: 'owner' })).toBe('owner')
  })

  it('reports paused or deleted accounts as inactive', () => {
    expect(decideStudioAccess(SESSION, AAL2, { state: 'inactive' })).toBe('inactive')
    expect(decideStudioAccess(SESSION, AAL1_NEEDS_2, { state: 'inactive' })).toBe('inactive')
    expect(decideStudioAccess(SESSION, AAL2, { state: 'no_account' })).toBe('inactive')
  })

  it('reports a revoked session (password reset) as ended, before asking for a code', () => {
    expect(decideStudioAccess(SESSION, AAL2, { state: 'session_ended' })).toBe('ended')
    expect(decideStudioAccess(SESSION, AAL1_NEEDS_2, { state: 'session_ended' })).toBe('ended')
  })

  it('treats an anonymous database view of a session as logged out', () => {
    expect(decideStudioAccess(SESSION, AAL2, { state: 'anonymous' })).toBe('login')
  })

  it('never says ok without a status', () => {
    expect(decideStudioAccess(SESSION, AAL2, null)).toBe('ended')
  })
})

describe('needsSecondFactor', () => {
  it('follows supabase-js, or the database when the cached user is stale', () => {
    expect(needsSecondFactor(AAL1_NEEDS_2, { state: 'ok' })).toBe(true)
    expect(needsSecondFactor(AAL1_ONLY, { state: 'mfa_required' })).toBe(true)
    expect(needsSecondFactor(null, { state: 'mfa_required' })).toBe(true)
    expect(needsSecondFactor(AAL1_ONLY, { state: 'ok' })).toBe(false)
    expect(needsSecondFactor(AAL2, { state: 'ok' })).toBe(false)
    expect(needsSecondFactor(null, null)).toBe(false)
  })
})

describe('access query key', () => {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const session = (user: string, sid: string, aal: string) =>
    ({ access_token: `${b64url({})}.${b64url({ aal, session_id: sid })}.sig`, user: { id: user } }) as unknown as Parameters<typeof accessKey>[0]

  it('changes with the user, the session and the AAL', () => {
    expect(accessKey(session('u1', 's1', 'aal1'))).toEqual(['studio', 'access', 'u1', 's1', 'aal1'])
    expect(accessKey(null)).toEqual(['studio', 'access', '', '', ''])
  })

  it('keeps the previous answer only for the same user while refetching', () => {
    const before = accessKey(session('u1', 's1', 'aal1'))
    const data = { state: 'ok' }
    // A device was just added: same user, now aal2 — keep the page mounted.
    expect(keepSameUser(data, before, accessKey(session('u1', 's1', 'aal2')))).toBe(data)
    // Someone else signed in on this tab: never show the previous account.
    expect(keepSameUser(data, before, accessKey(session('u2', 's2', 'aal1')))).toBeUndefined()
    expect(keepSameUser(data, undefined, before)).toBeUndefined()
    expect(keepSameUser(data, accessKey(null), accessKey(null))).toBeUndefined()
  })
})

describe('parsePostingStatus', () => {
  it('reads the ok shape', () => {
    const s = parsePostingStatus(okJson)
    expect(s).toEqual({ ...okJson, state: 'ok' })
  })

  it('keeps only the state and username for other states', () => {
    expect(parsePostingStatus({ state: 'owner', username: 'boss' })).toEqual({ state: 'owner', username: 'boss' })
    expect(parsePostingStatus({ state: 'session_ended' })).toEqual({ state: 'session_ended', username: null })
  })

  it('fills limits from the shared config when they are missing', () => {
    const { live_limit: _l, new_limit: _n, edits_limit: _e, ...rest } = okJson
    const s = parsePostingStatus(rest)
    expect(s.state === 'ok' && [s.live_limit, s.new_limit, s.edits_limit]).toEqual([15, 5, 30])
  })

  it('rejects unknown states and malformed orgs', () => {
    expect(() => parsePostingStatus(null)).toThrow()
    expect(() => parsePostingStatus({ state: 'admin' })).toThrow()
    expect(() => parsePostingStatus({ ...okJson, org: { ...okJson.org, campus: 'mars' } })).toThrow()
    expect(() => parsePostingStatus({ ...okJson, org: null })).toThrow()
  })
})

describe('tokenClaims', () => {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')

  it('reads aal and session_id from a JWT payload', () => {
    const token = `${b64url({ alg: 'ES256' })}.${b64url({ aal: 'aal2', session_id: 's-1', email: 'ünï@x' })}.sig`
    expect(tokenClaims(token)).toEqual({ aal: 'aal2', sessionId: 's-1' })
  })

  it('never throws on garbage', () => {
    expect(tokenClaims('not-a-jwt')).toEqual({ aal: null, sessionId: null })
    expect(tokenClaims('a.%%%.c')).toEqual({ aal: null, sessionId: null })
  })
})
