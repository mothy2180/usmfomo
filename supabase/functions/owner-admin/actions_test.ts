import { assertEquals, assertRejects } from '@std/assert'
import { RpcError } from '../_shared/db.ts'
import { HttpError } from '../_shared/http.ts'
import { BAN_DURATION, runAction } from './actions.ts'
import type { ActionRequest } from './request.ts'
import { account, CLUB_ID, fakePort, NEW_ORG_ID, NEW_USER_ID, ORG_ID, OWNER_ID, OWNER_ROW, POST_ID } from './testing.ts'

const PASSWORD = 'Generated-Password-24ch9'
const deps = (port: ReturnType<typeof fakePort>['port']) => ({ port, generatePassword: () => PASSWORD })

async function failsWith(promise: Promise<unknown>, code: string) {
  const err = await assertRejects(() => promise, HttpError)
  assertEquals(err.code, code)
}

const CREATE: ActionRequest = {
  action: 'create_account',
  username: 'csoc',
  orgName: 'Computer Science Society',
  orgSlug: 'csoc',
  type: 'club',
  campus: 'main',
}

Deno.test('status and list_accounts pass the RPC results through', async () => {
  const { port } = fakePort()
  assertEquals(await runAction({ action: 'status' }, deps(port)), { live_posts: 3 })
  const rows = (await runAction({ action: 'list_accounts' }, deps(port))) as unknown[]
  assertEquals(rows.length, 2)
})

Deno.test('create_account: auth user with the synthetic email, then the org account', async () => {
  const { port, calls } = fakePort()
  const data = await runAction(CREATE, deps(port))
  assertEquals(data, { userId: NEW_USER_ID, orgId: NEW_ORG_ID, username: 'csoc', password: PASSWORD })
  assertEquals(calls[0], { op: 'createAuthUser', args: ['csoc@usmfomo.pages.dev', PASSWORD] })
  assertEquals(calls[1].op, 'createOrgAccount')
  assertEquals(calls[1].args[0], NEW_USER_ID)
  assertEquals(calls.length, 2)
})

Deno.test('create_account: a failed org insert deletes the auth user again', async () => {
  const { port, calls } = fakePort({
    createOrgAccount: () => Promise.reject(new RpcError('admin_create_org_account', '23505', 'duplicate key')),
  })
  await assertRejects(() => runAction(CREATE, deps(port)), RpcError)
  assertEquals(calls.map((c) => c.op), ['createAuthUser', 'createOrgAccount', 'deleteAuthUser'])
  assertEquals(calls[2].args, [NEW_USER_ID])
})

Deno.test('create_account: an existing username is a conflict and creates nothing', async () => {
  const { port, ops } = fakePort({ createAuthUser: () => Promise.reject(new HttpError('conflict')) })
  await failsWith(runAction(CREATE, deps(port)), 'conflict')
  assertEquals(ops(), ['createAuthUser'])
})

Deno.test('reset_password: the one-time database grant, then the new password', async () => {
  const { port, calls } = fakePort()
  assertEquals(await runAction({ action: 'reset_password', userId: CLUB_ID }, deps(port)), { password: PASSWORD })
  assertEquals(calls.map((c) => [c.op, ...c.args]), [
    ['getAccount', CLUB_ID],
    ['allowPasswordChange', CLUB_ID],
    ['updateAuthUser', CLUB_ID, { password: PASSWORD }],
  ])
})

Deno.test('reset_password and handover: no new password when the grant fails', async () => {
  for (const action of ['reset_password', 'handover'] as const) {
    const { port, calls } = fakePort({
      allowPasswordChange: () => Promise.reject(new RpcError('admin_allow_password_change', 'P0001', 'user_not_found')),
    })
    await assertRejects(() => runAction({ action, userId: CLUB_ID }, deps(port)), RpcError)
    const passwordSet = calls.some((c) => c.op === 'updateAuthUser' && 'password' in (c.args[1] as object))
    assertEquals(passwordSet, false, action)
  }
})

Deno.test('account actions refuse the owner account and unknown users', async () => {
  const actions: ActionRequest[] = [
    { action: 'reset_password', userId: OWNER_ID },
    { action: 'handover', userId: OWNER_ID },
    { action: 'set_account_active', userId: OWNER_ID, active: false },
    { action: 'remove_factors', userId: OWNER_ID },
    { action: 'delete_account', userId: OWNER_ID },
  ]
  for (const req of actions) {
    const { port, ops } = fakePort()
    await failsWith(runAction(req, deps(port)), 'forbidden')
    assertEquals(ops(), ['getAccount'], req.action)
    const unknown = { ...req, userId: '99999999-9999-4999-8999-999999999999' } as ActionRequest
    const other = fakePort()
    await failsWith(runAction(unknown, deps(other.port)), 'not_found')
  }
})

Deno.test('account actions look the account up directly, never in the account list', async () => {
  // A list without the club, as if it sorted past a page PostgREST cut at 100 rows.
  const listed = Array.from(
    { length: 100 },
    (_, i) => account({ user_id: `00000000-0000-4000-8000-d${String(i).padStart(11, '0')}`, username: `club-${i}` }),
  )
  const actions: ActionRequest[] = [
    { action: 'reset_password', userId: CLUB_ID },
    { action: 'handover', userId: CLUB_ID },
    { action: 'set_account_active', userId: CLUB_ID, active: false },
    { action: 'remove_factors', userId: CLUB_ID },
    { action: 'delete_account', userId: CLUB_ID },
  ]
  for (const req of actions) {
    const { port, ops } = fakePort({ listAccounts: () => Promise.resolve(listed) })
    await runAction(req, deps(port))
    assertEquals(ops()[0], 'getAccount', req.action)
    assertEquals(ops().includes('listAccounts'), false, req.action)
  }
})

Deno.test('set_account_active: database flag first, then ban or unban', async () => {
  const off = fakePort()
  assertEquals(await runAction({ action: 'set_account_active', userId: CLUB_ID, active: false }, deps(off.port)), {})
  assertEquals(off.calls.slice(1), [
    { op: 'setAccountActive', args: [CLUB_ID, false] },
    { op: 'updateAuthUser', args: [CLUB_ID, { ban_duration: BAN_DURATION }] },
  ])
  assertEquals(BAN_DURATION, '876000h')

  const on = fakePort()
  await runAction({ action: 'set_account_active', userId: CLUB_ID, active: true }, deps(on.port))
  assertEquals(on.calls.slice(1), [
    { op: 'setAccountActive', args: [CLUB_ID, true] },
    { op: 'updateAuthUser', args: [CLUB_ID, { ban_duration: 'none' }] },
  ])
})

Deno.test('handover: deactivate, new password, delete factors, reactivate', async () => {
  const { port, calls } = fakePort()
  assertEquals(await runAction({ action: 'handover', userId: CLUB_ID }, deps(port)), { password: PASSWORD })
  assertEquals(calls.map((c) => [c.op, ...c.args]), [
    ['getAccount', CLUB_ID],
    ['setAccountActive', CLUB_ID, false],
    ['updateAuthUser', CLUB_ID, { ban_duration: BAN_DURATION }],
    ['allowPasswordChange', CLUB_ID],
    ['updateAuthUser', CLUB_ID, { password: PASSWORD }],
    ['listFactorIds', CLUB_ID],
    ['deleteFactor', CLUB_ID, 'f1'],
    ['deleteFactor', CLUB_ID, 'f2'],
    ['setAccountActive', CLUB_ID, true],
    ['updateAuthUser', CLUB_ID, { ban_duration: 'none' }],
  ])
})

Deno.test('handover: a failure midway leaves the account deactivated', async () => {
  const { port, ops } = fakePort({ deleteFactor: () => Promise.reject(new HttpError('internal')) })
  await failsWith(runAction({ action: 'handover', userId: CLUB_ID }, deps(port)), 'internal')
  assertEquals(ops().includes('setAccountActive'), true)
  assertEquals(ops().filter((o) => o === 'setAccountActive').length, 1)
})

Deno.test('remove_factors: deletes each factor, tolerates one already gone', async () => {
  const { port } = fakePort({
    listFactorIds: () => Promise.resolve(['f1', 'f2', 'f3']),
    deleteFactor: (_u, id) => (id === 'f2' ? Promise.reject(new HttpError('not_found')) : Promise.resolve()),
  })
  assertEquals(await runAction({ action: 'remove_factors', userId: CLUB_ID }, deps(port)), { removed: 2 })
})

Deno.test('update_org: passes the validated fields', async () => {
  const { port, calls } = fakePort()
  const req: ActionRequest = {
    action: 'update_org',
    orgId: ORG_ID,
    name: 'CS Society',
    slug: 'cs-society',
    type: 'club',
    campus: 'main',
    active: false,
  }
  assertEquals(await runAction(req, deps(port)), {})
  assertEquals(calls, [{ op: 'updateOrg', args: [req] }])
})

Deno.test('delete_account: stop writes, remove files, delete org, delete auth user', async () => {
  const { port, calls } = fakePort()
  assertEquals(await runAction({ action: 'delete_account', userId: CLUB_ID }, deps(port)), { removedFiles: 2 })
  assertEquals(calls.map((c) => [c.op, ...c.args]), [
    ['getAccount', CLUB_ID],
    ['setAccountActive', CLUB_ID, false],
    ['orgObjects', ORG_ID],
    ['removeFiles', [`${ORG_ID}/a.webp`, `${ORG_ID}/a-thumb.webp`]],
    ['deleteOrg', ORG_ID],
    ['deleteAuthUser', CLUB_ID],
  ])
})

Deno.test('delete_account: keeps the org when file removal fails', async () => {
  const { port, ops } = fakePort({ removeFiles: () => Promise.resolve({ removed: 0, failed: 2 }) })
  await failsWith(runAction({ action: 'delete_account', userId: CLUB_ID }, deps(port)), 'internal')
  assertEquals(ops().includes('deleteOrg'), false)
  assertEquals(ops().includes('deleteAuthUser'), false)
})

Deno.test('delete_account: finishes a leftover auth user without an account row', async () => {
  const leftover = '77777777-7777-4777-8777-777777777777'
  const { port, calls } = fakePort({ authUserExists: (id) => Promise.resolve(id === leftover) })
  assertEquals(await runAction({ action: 'delete_account', userId: leftover }, deps(port)), { removedFiles: 0 })
  assertEquals(calls.map((c) => [c.op, ...c.args]), [
    ['getAccount', leftover],
    ['authUserExists', leftover],
    ['deleteAuthUser', leftover],
  ])
})

Deno.test('delete_account: an account missing from the list still gets the full delete', async () => {
  // Only the direct lookup decides that there is no account row; a list that
  // lacks the account (cut, or stale in the console) must not leave its org behind.
  const { port, ops } = fakePort({
    listAccounts: () => Promise.resolve([OWNER_ROW]),
    authUserExists: () => Promise.resolve(true),
  })
  assertEquals(await runAction({ action: 'delete_account', userId: CLUB_ID }, deps(port)), { removedFiles: 2 })
  assertEquals(ops(), ['getAccount', 'setAccountActive', 'orgObjects', 'removeFiles', 'deleteOrg', 'deleteAuthUser'])
})

Deno.test('delete_post and remove_post_image: remove the returned files', async () => {
  for (const action of ['delete_post', 'remove_post_image'] as const) {
    const { port, calls } = fakePort()
    assertEquals(await runAction({ action, postId: POST_ID }, deps(port)), { removedFiles: 2, failedFiles: 0 })
    assertEquals(calls[1], { op: 'removeFiles', args: [[`${ORG_ID}/p.webp`, `${ORG_ID}/p-thumb.webp`]] })
  }
})

Deno.test('delete_post: unknown post is 404; a post without image removes nothing', async () => {
  const missing = fakePort({ deletePost: () => Promise.resolve([]) })
  await failsWith(runAction({ action: 'delete_post', postId: POST_ID }, deps(missing.port)), 'not_found')
  assertEquals(missing.ops(), ['deletePost'])

  const bare = fakePort({ removePostImage: () => Promise.resolve([{ poster_path: null, thumb_path: null }]) })
  assertEquals(await runAction({ action: 'remove_post_image', postId: POST_ID }, deps(bare.port)), {
    removedFiles: 0,
    failedFiles: 0,
  })
})

Deno.test('delete_post and remove_post_image: the row change stands when Storage fails, failedFiles says so', async () => {
  for (const action of ['delete_post', 'remove_post_image'] as const) {
    const { port, ops } = fakePort({ removeFiles: () => Promise.resolve({ removed: 0, failed: 2 }) })
    assertEquals(await runAction({ action, postId: POST_ID }, deps(port)), { removedFiles: 0, failedFiles: 2 })
    assertEquals(ops().slice(1), ['removeFiles'], action)
  }
  const partly = fakePort({ removeFiles: () => Promise.resolve({ removed: 1, failed: 1 }) })
  assertEquals(await runAction({ action: 'delete_post', postId: POST_ID }, deps(partly.port)), {
    removedFiles: 1,
    failedFiles: 1,
  })
})
