// OwnerAdminPort over plain fetch, for the owner CLI. The account rules live
// in supabase/functions/owner-admin/actions.ts and run unchanged on top of
// this port, so the CLI and the owner console behave the same way.
import type { Database } from '../../packages/shared/src/database.types.ts'
import { HttpError } from '../../supabase/functions/_shared/http.ts'
import { POSTERS_BUCKET, removeInBatches } from '../../supabase/functions/_shared/storage.ts'
import type { CreateAccountInput, UpdateOrgInput } from '../../supabase/functions/owner-admin/request.ts'
import type { AccountRow, OwnerAdminPort, PosterPaths } from '../../supabase/functions/owner-admin/types.ts'
import { ApiError, type RestClient } from './rest.ts'

type Functions = Database['public']['Functions']
type AdminFunction = Extract<keyof Functions, `admin_${string}`>

export interface CliPort extends OwnerAdminPort {
  /** admin_link_owner: marks an existing auth user as the owner account. */
  linkOwner(userId: string, username: string): Promise<void>
}

const isNotFound = (err: unknown) => err instanceof ApiError && err.status === 404

export function createCliPort(client: RestClient): CliPort {
  // Argument names are checked against the generated database types.
  const rpc = <F extends AdminFunction>(fn: F, args: Functions[F]['Args']) =>
    client.request('rest', 'POST', `/rpc/${fn}`, args)
  const user = (id: string) => `/admin/users/${encodeURIComponent(id)}`
  const notForCli = (): never => {
    throw new Error('session checks are not used by the owner CLI')
  }

  return {
    verifyToken: notForCli,
    sessionUserId: notForCli,
    isOwner: async (userId) => (await rpc('admin_is_owner', { p_uid: userId })) === true,

    status: () => rpc('admin_status', {}),
    listAccounts: async () => ((await rpc('admin_list_accounts', {})) ?? []) as AccountRow[],
    async authUserExists(userId) {
      try {
        await client.request('auth', 'GET', user(userId))
        return true
      } catch (err) {
        if (isNotFound(err)) return false
        throw err
      }
    },
    async listFactorIds(userId) {
      const factors = (await client.request('auth', 'GET', `${user(userId)}/factors`)) as Array<{ id: string }> | null
      return (factors ?? []).map((f) => f.id)
    },
    async orgObjects(orgId) {
      const rows = (await rpc('admin_org_objects', { p_org: orgId })) as Array<{ name: string }> | null
      return (rows ?? []).map((r) => r.name)
    },

    async createAuthUser(email, password) {
      const created = (await client.request('auth', 'POST', '/admin/users', {
        email,
        password,
        email_confirm: true,
      })) as { id?: unknown } | null
      if (typeof created?.id !== 'string') throw new ApiError('auth', 200, '', 'Auth returned no user id')
      return created.id
    },
    async updateAuthUser(userId, update) {
      await client.request('auth', 'PUT', user(userId), update)
    },
    async deleteFactor(userId, factorId) {
      try {
        await client.request('auth', 'DELETE', `${user(userId)}/factors/${encodeURIComponent(factorId)}`)
      } catch (err) {
        // Same contract as the Edge Function's port: an already-deleted factor is not_found.
        if (isNotFound(err)) throw new HttpError('not_found')
        throw err
      }
    },
    async deleteAuthUser(userId) {
      await client.request('auth', 'DELETE', user(userId))
    },
    async createOrgAccount(userId, input: CreateAccountInput) {
      return (await rpc('admin_create_org_account', {
        p_user: userId,
        p_username: input.username,
        p_org_name: input.orgName,
        p_org_slug: input.orgSlug,
        p_type: input.type,
        p_campus: input.campus,
      })) as string
    },
    async setAccountActive(userId, active) {
      await rpc('admin_set_account_active', { p_user: userId, p_active: active })
    },
    async updateOrg(input: UpdateOrgInput) {
      await rpc('admin_update_org', {
        p_org: input.orgId,
        p_name: input.name,
        p_slug: input.slug,
        p_type: input.type,
        p_campus: input.campus,
        p_active: input.active,
      })
    },
    async deleteOrg(orgId) {
      await rpc('admin_delete_org', { p_org: orgId })
    },
    deletePost: async (postId) => ((await rpc('admin_delete_post', { p_post: postId })) ?? []) as PosterPaths[],
    removePostImage: async (postId) =>
      ((await rpc('admin_remove_post_image', { p_post: postId })) ?? []) as PosterPaths[],
    removeFiles: (paths) =>
      removeInBatches(async (names) => {
        const deleted = await client.request('storage', 'DELETE', `/object/${POSTERS_BUCKET}`, { prefixes: names })
        return Array.isArray(deleted) ? deleted.length : 0
      }, paths),

    async linkOwner(userId, username) {
      await rpc('admin_link_owner', { p_user: userId, p_username: username })
    },
  }
}
