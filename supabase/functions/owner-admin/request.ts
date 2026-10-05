// Request bodies of owner-admin (docs/api.md): `{ "action": string, ...params }`.
// Parsing normalises every parameter; anything invalid is a 400 bad_request.
import { HttpError } from '../_shared/http.ts'
import * as v from '../_shared/validate.ts'
import type { OrgCampus, OrgType } from '../_shared/validate.ts'

export const MAX_BODY_BYTES = 8 * 1024

export type CreateAccountInput = {
  username: string
  orgName: string
  orgSlug: string
  type: OrgType
  campus: OrgCampus
}

export type UpdateOrgInput = {
  orgId: string
  name: string
  slug: string
  type: OrgType
  campus: OrgCampus
  active: boolean
}

export type ActionRequest =
  | { action: 'status' }
  | { action: 'list_accounts' }
  | ({ action: 'create_account' } & CreateAccountInput)
  | { action: 'reset_password'; userId: string }
  | { action: 'handover'; userId: string }
  | { action: 'set_account_active'; userId: string; active: boolean }
  | ({ action: 'update_org' } & UpdateOrgInput)
  | { action: 'remove_factors'; userId: string }
  | { action: 'delete_account'; userId: string }
  | { action: 'delete_post'; postId: string }
  | { action: 'remove_post_image'; postId: string }

export type ActionName = ActionRequest['action']

function badRequest(): never {
  throw new HttpError('bad_request')
}

function required<T>(value: T | null): T {
  return value === null ? badRequest() : value
}

export function parseActionRequest(body: unknown): ActionRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) badRequest()
  const b = body as Record<string, unknown>
  switch (b.action) {
    case 'status':
      return { action: 'status' }
    case 'list_accounts':
      return { action: 'list_accounts' }
    case 'create_account':
      return {
        action: 'create_account',
        username: required(v.username(b.username)),
        orgName: required(v.orgName(b.orgName)),
        orgSlug: required(v.orgSlug(b.orgSlug)),
        type: required(v.orgType(b.type)),
        campus: required(v.orgCampus(b.campus)),
      }
    case 'reset_password':
      return { action: 'reset_password', userId: required(v.uuid(b.userId)) }
    case 'handover':
      return { action: 'handover', userId: required(v.uuid(b.userId)) }
    case 'set_account_active':
      return { action: 'set_account_active', userId: required(v.uuid(b.userId)), active: required(v.bool(b.active)) }
    case 'update_org':
      return {
        action: 'update_org',
        orgId: required(v.uuid(b.orgId)),
        name: required(v.orgName(b.name)),
        slug: required(v.orgSlug(b.slug)),
        type: required(v.orgType(b.type)),
        campus: required(v.orgCampus(b.campus)),
        active: required(v.bool(b.active)),
      }
    case 'remove_factors':
      return { action: 'remove_factors', userId: required(v.uuid(b.userId)) }
    case 'delete_account':
      return { action: 'delete_account', userId: required(v.uuid(b.userId)) }
    case 'delete_post':
      return { action: 'delete_post', postId: required(v.uuid(b.postId)) }
    case 'remove_post_image':
      return { action: 'remove_post_image', postId: required(v.uuid(b.postId)) }
    default:
      return badRequest()
  }
}

/** Parses a raw request body (at most MAX_BODY_BYTES of JSON). */
export function parseActionBody(text: string): ActionRequest {
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) badRequest()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    badRequest()
  }
  return parseActionRequest(body)
}
