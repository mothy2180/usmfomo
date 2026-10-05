// OwnerAdminPort (types.ts) backed by the secret-key supabase-js client:
// token checks, Auth Admin API, admin_* RPCs and Storage.
import type { AdminClient } from '../_shared/client.ts'
import { rpc } from '../_shared/db.ts'
import { HttpError } from '../_shared/http.ts'
import { posterRemover, removeInBatches } from '../_shared/storage.ts'
import type { AccountRow, OwnerAdminPort, PosterPaths } from './types.ts'

type AuthErrorLike = { name?: string; code?: string; status?: number }

/** Network trouble or a 5xx from Auth is our fault (500), not the caller's. */
function isServerSide(error: AuthErrorLike): boolean {
  return error.name === 'AuthRetryableFetchError' || (typeof error.status === 'number' && error.status >= 500)
}

/** Maps an Auth Admin API error to an owner-admin error code. */
export function httpErrorFromAuth(error: AuthErrorLike): HttpError {
  if (error.code === 'user_not_found' || error.status === 404) return new HttpError('not_found')
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return new HttpError('conflict')
  return new HttpError('internal')
}

/** Maps a token-check error: invalid or ended tokens are 401, Auth outages 500. */
export function httpErrorFromToken(error: AuthErrorLike): HttpError {
  return new HttpError(isServerSide(error) ? 'internal' : 'unauthorized')
}

export function createOwnerAdminPort(client: AdminClient): OwnerAdminPort {
  const admin = client.auth.admin
  const remove = posterRemover(client)

  return {
    async verifyToken(token) {
      let result: Awaited<ReturnType<typeof client.auth.getClaims>>
      try {
        result = await client.auth.getClaims(token)
      } catch {
        // getClaims returns Auth errors but rethrows anything else raised while
        // decoding or verifying the token (segments that are not JSON, an
        // unsupported alg, a malformed signature): the token is invalid.
        throw new HttpError('unauthorized')
      }
      const { data, error } = result
      if (error) throw httpErrorFromToken(error)
      if (!data) throw new HttpError('unauthorized')
      return { sub: data.claims.sub, role: data.claims.role, aal: data.claims.aal }
    },
    async sessionUserId(token) {
      const { data, error } = await client.auth.getUser(token)
      if (error) throw httpErrorFromToken(error)
      if (!data.user) throw new HttpError('unauthorized')
      return data.user.id
    },
    isOwner: (userId) => rpc<boolean>(client, 'admin_is_owner', { p_uid: userId }),

    status: () => rpc<unknown>(client, 'admin_status'),
    listAccounts: () => rpc<AccountRow[]>(client, 'admin_list_accounts'),
    async authUserExists(userId) {
      const { data, error } = await admin.getUserById(userId)
      if (error) {
        const mapped = httpErrorFromAuth(error)
        if (mapped.code === 'not_found') return false
        throw mapped
      }
      return data.user !== null
    },
    async listFactorIds(userId) {
      const { data, error } = await admin.mfa.listFactors({ userId })
      if (error) throw httpErrorFromAuth(error)
      return data.factors.map((f) => f.id)
    },
    async orgObjects(orgId) {
      const rows = await rpc<{ name: string }[]>(client, 'admin_org_objects', { p_org: orgId })
      return rows.map((r) => r.name)
    },

    async createAuthUser(email, password) {
      const { data, error } = await admin.createUser({ email, password, email_confirm: true })
      if (error) throw httpErrorFromAuth(error)
      if (!data.user) throw new HttpError('internal')
      return data.user.id
    },
    async updateAuthUser(userId, update) {
      const { error } = await admin.updateUserById(userId, update)
      if (error) throw httpErrorFromAuth(error)
    },
    async deleteFactor(userId, factorId) {
      const { error } = await admin.mfa.deleteFactor({ userId, id: factorId })
      if (error) throw httpErrorFromAuth(error)
    },
    async deleteAuthUser(userId) {
      const { error } = await admin.deleteUser(userId)
      if (error) throw httpErrorFromAuth(error)
    },
    createOrgAccount: (userId, input) =>
      rpc<string>(client, 'admin_create_org_account', {
        p_user: userId,
        p_username: input.username,
        p_org_name: input.orgName,
        p_org_slug: input.orgSlug,
        p_type: input.type,
        p_campus: input.campus,
      }),
    async setAccountActive(userId, active) {
      await rpc<null>(client, 'admin_set_account_active', { p_user: userId, p_active: active })
    },
    async updateOrg(input) {
      await rpc<null>(client, 'admin_update_org', {
        p_org: input.orgId,
        p_name: input.name,
        p_slug: input.slug,
        p_type: input.type,
        p_campus: input.campus,
        p_active: input.active,
      })
    },
    async deleteOrg(orgId) {
      await rpc<null>(client, 'admin_delete_org', { p_org: orgId })
    },
    deletePost: (postId) => rpc<PosterPaths[]>(client, 'admin_delete_post', { p_post: postId }),
    removePostImage: (postId) => rpc<PosterPaths[]>(client, 'admin_remove_post_image', { p_post: postId }),
    removeFiles: (paths) => removeInBatches(remove, paths),
  }
}
