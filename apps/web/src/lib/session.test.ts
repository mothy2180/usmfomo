import { describe, expect, it, vi } from 'vitest'

// session.ts imports the real client; tests only need the pure functions.
vi.mock('./db.ts', () => ({ studioDb: {} }))

const { accessKey, decideStudioAccess, parsePostingStatus, POSTING_STATES, tokenSessionId } = await import('./session.ts')

const SESSION = { access_token: 'x' }

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
}

describe('decideStudioAccess', () => {
  it('sends visitors without a session to the login page', () => {
    expect(decideStudioAccess(null, null)).toBe('login')
    expect(decideStudioAccess(null, { state: 'ok' })).toBe('login')
  })

  it('lets a club in when the database says ok', () => {
    expect(decideStudioAccess(SESSION, { state: 'ok' })).toBe('ok')
  })

  it('keeps the owner out of the studio', () => {
    expect(decideStudioAccess(SESSION, { state: 'owner' })).toBe('owner')
  })

  it('reports paused or deleted accounts as inactive', () => {
    expect(decideStudioAccess(SESSION, { state: 'inactive' })).toBe('inactive')
    expect(decideStudioAccess(SESSION, { state: 'no_account' })).toBe('inactive')
  })

  it('reports a revoked session (password reset) as ended', () => {
    expect(decideStudioAccess(SESSION, { state: 'session_ended' })).toBe('ended')
  })

  it('treats an anonymous database view of a session as logged out', () => {
    expect(decideStudioAccess(SESSION, { state: 'anonymous' })).toBe('login')
  })

  it('never says ok without a status', () => {
    expect(decideStudioAccess(SESSION, null)).toBe('ended')
  })
})

describe('access query key', () => {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const session = (user: string, sid: string) =>
    ({ access_token: `${b64url({})}.${b64url({ session_id: sid })}.sig`, user: { id: user } }) as unknown as Parameters<typeof accessKey>[0]

  it('changes with the user and the session', () => {
    expect(accessKey(session('u1', 's1'))).toEqual(['studio', 'access', 'u1', 's1'])
    expect(accessKey(session('u1', 's2'))).not.toEqual(accessKey(session('u1', 's1')))
    expect(accessKey(session('u2', 's1'))).not.toEqual(accessKey(session('u1', 's1')))
    expect(accessKey(null)).toEqual(['studio', 'access', '', ''])
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

  it('ignores a factors field from an older database', () => {
    const s = parsePostingStatus({ ...okJson, factors: 2 })
    expect(s).toEqual({ ...okJson, state: 'ok' })
  })

  it('rejects unknown states and malformed orgs', () => {
    expect(POSTING_STATES).not.toContain('mfa_required')
    expect(() => parsePostingStatus(null)).toThrow()
    expect(() => parsePostingStatus({ state: 'admin' })).toThrow()
    expect(() => parsePostingStatus({ state: 'mfa_required' })).toThrow()
    expect(() => parsePostingStatus({ ...okJson, org: { ...okJson.org, campus: 'mars' } })).toThrow()
    expect(() => parsePostingStatus({ ...okJson, org: null })).toThrow()
  })
})

describe('tokenSessionId', () => {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')

  it('reads session_id from a JWT payload', () => {
    const token = `${b64url({ alg: 'ES256' })}.${b64url({ session_id: 's-1', email: 'ünï@x' })}.sig`
    expect(tokenSessionId(token)).toBe('s-1')
  })

  it('never throws on garbage', () => {
    expect(tokenSessionId('not-a-jwt')).toBeNull()
    expect(tokenSessionId('a.%%%.c')).toBeNull()
  })
})
