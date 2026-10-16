// What each owner-admin action does (docs/api.md table). Runs only after
// authorise() accepted a live owner session.
//
// Account actions manage club/school accounts. The owner account itself is
// refused (403 forbidden) so the console cannot lock its own owner out; the
// owner CLI (scripts/account.ts) is the break-glass for it.
//
// The owner CLI runs these same functions through its own fetch-based port
// (scripts/lib/port.ts), so keep this file free of runtime-specific imports.
//
// Every decision about one account looks it up directly (getAccount), never
// by searching the account list.
import { HttpError } from '../_shared/http.ts'
import { usernameToEmail } from '../_shared/validate.ts'
import type { ActionRequest, CreateAccountInput } from './request.ts'
import type { AccountRow, OwnerAdminPort, PosterPaths } from './types.ts'

/** Auth "ban" for deactivated accounts: 100 years. 'none' lifts it. */
export const BAN_DURATION = '876000h'

export type ActionDeps = {
  port: OwnerAdminPort
  generatePassword: () => string
}

export type CreatedAccount = { userId: string; orgId: string; username: string; password: string }
export type NewPassword = { password: string }
export type RenamedAccount = { username: string }
export type RemovedFiles = { removedFiles: number }
/** Poster files of a deleted post or removed image: failedFiles stay public until the daily orphan sweep. */
export type PosterFiles = { removedFiles: number; failedFiles: number }

export async function runAction(req: ActionRequest, deps: ActionDeps): Promise<unknown> {
  const { port } = deps
  switch (req.action) {
    case 'status':
      return await port.status()
    case 'list_accounts':
      return await port.listAccounts()
    case 'create_account': {
      const { password, ...input } = req
      return await createAccount(deps, input, password)
    }
    case 'reset_password':
      return await resetPassword(deps, req.userId, req.password)
    case 'handover':
      return await handover(deps, req.userId, req.password)
    case 'set_account_active':
      await clubAccount(port, req.userId)
      await setActive(port, req.userId, req.active)
      return {}
    case 'update_org':
      await port.updateOrg(req)
      return {}
    case 'rename_account':
      return await renameAccount(port, req.userId, req.username)
    case 'delete_account':
      return await deleteAccount(port, req.userId)
    case 'delete_post':
      return await removePosterFiles(port, await port.deletePost(req.postId))
    case 'remove_post_image':
      return await removePosterFiles(port, await port.removePostImage(req.postId))
  }
}

/** The club/school account with this user id: 404 when unknown, 403 for the owner account. */
async function clubAccount(port: OwnerAdminPort, userId: string): Promise<AccountRow & { org_id: string }> {
  const row = await port.getAccount(userId)
  if (!row) throw new HttpError('not_found')
  if (row.is_owner || row.org_id === null) throw new HttpError('forbidden')
  return { ...row, org_id: row.org_id }
}

/** `chosen` is a password the owner typed (already validated); without one, a generated password. */
export async function createAccount(
  deps: ActionDeps,
  input: CreateAccountInput,
  chosen?: string,
): Promise<CreatedAccount> {
  const { port } = deps
  const password = chosen ?? deps.generatePassword()
  const userId = await port.createAuthUser(usernameToEmail(input.username), password)
  try {
    const orgId = await port.createOrgAccount(userId, input)
    return { userId, orgId, username: input.username, password }
  } catch (err) {
    // No half-created accounts: the auth user goes when its org/account row fails.
    try {
      await port.deleteAuthUser(userId)
    } catch {
      console.error(JSON.stringify({ event: 'create_account_cleanup_failed' }))
    }
    throw err
  }
}

/**
 * Sets a new password, which ends every session of that user. The database
 * refuses a new password without a one-time grant (0052), so the grant goes
 * right before the change.
 */
export async function setPassword(port: OwnerAdminPort, userId: string, password: string): Promise<void> {
  await port.allowPasswordChange(userId)
  await port.updateAuthUser(userId, { password })
}

async function resetPassword(deps: ActionDeps, userId: string, chosen?: string): Promise<NewPassword> {
  await clubAccount(deps.port, userId)
  const password = chosen ?? deps.generatePassword()
  await setPassword(deps.port, userId, password)
  return { password }
}

/** The database flag first (writes stop at once), then the Auth ban (sign-in and refresh stop). */
export async function setActive(port: OwnerAdminPort, userId: string, active: boolean): Promise<void> {
  await port.setAccountActive(userId, active)
  await port.updateAuthUser(userId, { ban_duration: active ? 'none' : BAN_DURATION })
}

/** New committee: deactivate → new password (ends sessions) → reactivate. */
export async function handover(deps: ActionDeps, userId: string, chosen?: string): Promise<NewPassword> {
  const { port } = deps
  await clubAccount(port, userId)
  await setActive(port, userId, false)
  const password = chosen ?? deps.generatePassword()
  await setPassword(port, userId, password)
  await setActive(port, userId, true)
  return { password }
}

/**
 * A new login name for a club or school account: the Auth email first, then
 * admin_rename_account (0056). If the database refuses, the old email goes
 * back, so sign-in and the account row never disagree. Sessions stay signed
 * in; the next sign-in needs the new name. The current name again changes
 * nothing. A name another account has is a 409 before anything changes (Auth
 * answers a taken email on update with a bare 500).
 */
export async function renameAccount(port: OwnerAdminPort, userId: string, username: string): Promise<RenamedAccount> {
  const row = await clubAccount(port, userId)
  if (row.username === username) return { username }
  if (await port.getAccountByUsername(username)) throw new HttpError('conflict')
  await port.updateAuthUser(userId, { email: usernameToEmail(username), email_confirm: true })
  try {
    await port.renameAccount(userId, username)
  } catch (err) {
    try {
      await port.updateAuthUser(userId, { email: usernameToEmail(row.username), email_confirm: true })
    } catch {
      console.error(JSON.stringify({ event: 'rename_account_revert_failed' }))
    }
    throw err
  }
  return { username }
}

export async function deleteAccount(port: OwnerAdminPort, userId: string): Promise<RemovedFiles> {
  const row = await port.getAccount(userId)
  if (!row) {
    // The direct lookup found no account row. An auth user without one was
    // left over by a failed create or delete and can only be garbage
    // (sign-ups are off), so finish the job.
    if (await port.authUserExists(userId)) {
      await port.deleteAuthUser(userId)
      return { removedFiles: 0 }
    }
    throw new HttpError('not_found')
  }
  if (row.is_owner || row.org_id === null) throw new HttpError('forbidden')

  // Stop new uploads first, so no file can appear after the listing below.
  await port.setAccountActive(userId, false)
  const removal = await port.removeFiles(await port.orgObjects(row.org_id))
  // Keep the org while files remain, so a retry can still find and remove them.
  if (removal.failed > 0) throw new HttpError('internal')
  await port.deleteOrg(row.org_id)
  await port.deleteAuthUser(userId)
  return { removedFiles: removal.removed }
}

/**
 * Files of a post the database already changed. The row change stands even
 * when Storage fails: files it could not remove are no longer referenced, so
 * the daily orphan sweep deletes them later (removeInBatches logs the count).
 * failedFiles tells the console that those files stay public until then.
 */
async function removePosterFiles(port: OwnerAdminPort, rows: PosterPaths[]): Promise<PosterFiles> {
  if (rows.length === 0) throw new HttpError('not_found')
  const removal = await port.removeFiles(rows.flatMap((r) => [r.poster_path, r.thumb_path]))
  return { removedFiles: removal.removed, failedFiles: removal.failed }
}
