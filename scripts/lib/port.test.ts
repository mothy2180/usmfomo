import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HttpError } from '../../supabase/functions/_shared/http.ts'
import { createCliPort } from './port.ts'
import { ApiError, type RestClient, type Service } from './rest.ts'
import { CLUB_ID, ORG_ID } from './testing.ts'

type Request = { service: Service; method: string; path: string; body: unknown }

function fakeClient(respond: (req: Request) => unknown) {
  const requests: Request[] = []
  const client: RestClient = {
    request(service, method, path, body) {
      const req = { service, method, path, body }
      requests.push(req)
      try {
        return Promise.resolve(respond(req))
      } catch (err) {
        return Promise.reject(err)
      }
    },
  }
  return { client, requests }
}

const notFound = (service: Service) => new ApiError(service, 404, 'user_not_found', 'User not found')

describe('createCliPort', () => {
  it('maps every RPC to POST /rpc/<name> with the documented arguments', async () => {
    const { client, requests } = fakeClient(() => null)
    const port = createCliPort(client)
    await port.setAccountActive(CLUB_ID, false)
    await port.createOrgAccount(CLUB_ID, {
      username: 'csoc',
      orgName: 'CS',
      orgSlug: 'cs',
      type: 'club',
      campus: 'main',
    })
    await port.deleteOrg(ORG_ID)
    await port.linkOwner(CLUB_ID, 'owner')
    await port.updateOrg({ orgId: ORG_ID, name: 'CS', slug: 'cs', type: 'school', campus: 'health', active: false })
    assert.deepEqual(await port.listAccounts(), [])
    assert.deepEqual(await port.deletePost('p'), [])
    assert.deepEqual(requests, [
      {
        service: 'rest',
        method: 'POST',
        path: '/rpc/admin_set_account_active',
        body: { p_user: CLUB_ID, p_active: false },
      },
      {
        service: 'rest',
        method: 'POST',
        path: '/rpc/admin_create_org_account',
        body: {
          p_user: CLUB_ID,
          p_username: 'csoc',
          p_org_name: 'CS',
          p_org_slug: 'cs',
          p_type: 'club',
          p_campus: 'main',
        },
      },
      { service: 'rest', method: 'POST', path: '/rpc/admin_delete_org', body: { p_org: ORG_ID } },
      {
        service: 'rest',
        method: 'POST',
        path: '/rpc/admin_link_owner',
        body: { p_user: CLUB_ID, p_username: 'owner' },
      },
      {
        service: 'rest',
        method: 'POST',
        path: '/rpc/admin_update_org',
        body: { p_org: ORG_ID, p_name: 'CS', p_slug: 'cs', p_type: 'school', p_campus: 'health', p_active: false },
      },
      { service: 'rest', method: 'POST', path: '/rpc/admin_list_accounts', body: {} },
      { service: 'rest', method: 'POST', path: '/rpc/admin_delete_post', body: { p_post: 'p' } },
    ])
  })

  it('uses the Auth Admin API for users and factors', async () => {
    const { client, requests } = fakeClient((req) => {
      if (req.method === 'POST') return { id: CLUB_ID }
      if (req.path.endsWith('/factors')) return [{ id: 'f1' }, { id: 'f2' }]
      return {}
    })
    const port = createCliPort(client)
    assert.equal(await port.createAuthUser('csoc@usmfomo.pages.dev', 'pw'), CLUB_ID)
    assert.deepEqual(await port.listFactorIds(CLUB_ID), ['f1', 'f2'])
    await port.updateAuthUser(CLUB_ID, { ban_duration: '876000h' })
    await port.deleteFactor(CLUB_ID, 'f1')
    await port.deleteAuthUser(CLUB_ID)
    assert.deepEqual(requests, [
      {
        service: 'auth',
        method: 'POST',
        path: '/admin/users',
        body: { email: 'csoc@usmfomo.pages.dev', password: 'pw', email_confirm: true },
      },
      { service: 'auth', method: 'GET', path: `/admin/users/${CLUB_ID}/factors`, body: undefined },
      { service: 'auth', method: 'PUT', path: `/admin/users/${CLUB_ID}`, body: { ban_duration: '876000h' } },
      { service: 'auth', method: 'DELETE', path: `/admin/users/${CLUB_ID}/factors/f1`, body: undefined },
      { service: 'auth', method: 'DELETE', path: `/admin/users/${CLUB_ID}`, body: undefined },
    ])
  })

  it('404s: a missing user does not exist, a missing factor is not_found', async () => {
    const port = createCliPort(
      fakeClient(() => {
        throw notFound('auth')
      }).client,
    )
    assert.equal(await port.authUserExists(CLUB_ID), false)
    await assert.rejects(
      port.deleteFactor(CLUB_ID, 'f1'),
      (err: unknown) => err instanceof HttpError && err.code === 'not_found',
    )
    await assert.rejects(port.deleteAuthUser(CLUB_ID), ApiError)
    const exists = createCliPort(fakeClient(() => ({ id: CLUB_ID })).client)
    assert.equal(await exists.authUserExists(CLUB_ID), true)
    const failing = createCliPort(
      fakeClient(() => {
        throw new ApiError('auth', 500, '', 'down')
      }).client,
    )
    await assert.rejects(failing.authUserExists(CLUB_ID), ApiError)
  })

  it('removes poster files in batches of 1000 through the Storage API', async () => {
    const { client, requests } = fakeClient((req) =>
      (req.body as { prefixes: string[] }).prefixes.map((name) => ({ name }))
    )
    const names = Array.from({ length: 1500 }, (_, i) => `${ORG_ID}/${i}.webp`)
    assert.deepEqual(await createCliPort(client).removeFiles([...names, null]), { removed: 1500, failed: 0 })
    assert.deepEqual(
      requests.map((r) => [r.service, r.method, r.path, (r.body as { prefixes: string[] }).prefixes.length]),
      [
        ['storage', 'DELETE', '/object/posters', 1000],
        ['storage', 'DELETE', '/object/posters', 500],
      ],
    )
  })

  it('a session check is never needed by the CLI', async () => {
    const port = createCliPort(fakeClient(() => null).client)
    assert.throws(() => port.verifyToken('x'), /not used by the owner CLI/)
    assert.equal(await port.isOwner(CLUB_ID), false)
  })
})
