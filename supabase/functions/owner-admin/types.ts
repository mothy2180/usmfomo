// The side effects owner-admin's actions need, as an interface with no
// runtime-specific imports. Two implementations exist:
//   - port.ts: supabase-js with the secret key (this Edge Function)
//   - scripts/lib/port.ts: plain fetch from the owner CLI (Node), which runs
//     the same actions.ts, so the console and the CLI follow the same rules.
import type { OrgCampus, OrgType } from '../_shared/validate.ts'
import type { RemoveResult } from '../_shared/storage.ts'
import type { CreateAccountInput, UpdateOrgInput } from './request.ts'

/** A row of admin_list_accounts() (0050_service_rpcs.sql). */
export type AccountRow = {
  user_id: string
  username: string
  is_owner: boolean
  account_active: boolean
  org_id: string | null
  org_name: string | null
  org_slug: string | null
  org_type: OrgType | null
  org_campus: OrgCampus | null
  org_active: boolean | null
  created_at: string
  last_sign_in_at: string | null
  banned_until: string | null
  factor_count: number
  newest_factor_at: string | null
  live_posts: number
}

export type PosterPaths = { poster_path: string | null; thumb_path: string | null }

export type TokenClaims = { sub: unknown; role: unknown; aal: unknown }

export type AuthUserUpdate = { password: string } | { ban_duration: string }

export interface OwnerAdminPort {
  /** auth.getClaims: verifies the signature (JWKS) and expiry. */
  verifyToken(token: string): Promise<TokenClaims>
  /** auth.getUser: the user id, if the session is live and the user is not banned. */
  sessionUserId(token: string): Promise<string>
  isOwner(userId: string): Promise<boolean>

  status(): Promise<unknown>
  listAccounts(): Promise<AccountRow[]>
  authUserExists(userId: string): Promise<boolean>
  listFactorIds(userId: string): Promise<string[]>
  orgObjects(orgId: string): Promise<string[]>

  createAuthUser(email: string, password: string): Promise<string>
  updateAuthUser(userId: string, update: AuthUserUpdate): Promise<void>
  /** Throws HttpError('not_found') when the factor is already gone. */
  deleteFactor(userId: string, factorId: string): Promise<void>
  deleteAuthUser(userId: string): Promise<void>
  createOrgAccount(userId: string, input: CreateAccountInput): Promise<string>
  setAccountActive(userId: string, active: boolean): Promise<void>
  updateOrg(input: UpdateOrgInput): Promise<void>
  deleteOrg(orgId: string): Promise<void>
  deletePost(postId: string): Promise<PosterPaths[]>
  removePostImage(postId: string): Promise<PosterPaths[]>
  removeFiles(paths: ReadonlyArray<string | null>): Promise<RemoveResult>
}
