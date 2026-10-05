// Typed client for the owner-admin Edge Function (docs/api.md). Every call is
// POST /functions/v1/owner-admin with { action, ...params }; supabase-js adds
// the apikey header and the owner's access token. Responses are validated and
// every failure becomes an AdminApiError with a stable code. This module has no
// side effects (no env, no client) so it can be unit-tested with a fake invoke.
import { CAMPUSES, ORG_TYPES, type Campus, type OrgType } from '@usmfomo/shared/config'
import { z } from './zod.ts'

export const OWNER_ADMIN_FUNCTION = 'owner-admin'

/** Error codes the function returns in `{ ok: false, error }` (docs/api.md). */
export const SERVER_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'mfa_required',
  'not_found',
  'conflict',
  'internal',
] as const
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number]

/** Contract codes plus failures detected in the browser. */
export type AdminErrorCode =
  | ServerErrorCode
  | 'network'
  | 'unavailable'
  | 'rate_limited'
  | 'service_restricted'
  | 'bad_response'
  | 'unknown'

export type AdminAction =
  | 'status'
  | 'list_accounts'
  | 'create_account'
  | 'reset_password'
  | 'handover'
  | 'set_account_active'
  | 'update_org'
  | 'remove_factors'
  | 'delete_account'
  | 'delete_post'
  | 'remove_post_image'

export class AdminApiError extends Error {
  readonly action: AdminAction
  readonly code: AdminErrorCode
  readonly status: number | null
  /** The function's own error string when it is not a contract code (e.g. "not_implemented"). */
  readonly serverCode: string | null

  constructor(action: AdminAction, code: AdminErrorCode, status: number | null = null, serverCode: string | null = null) {
    super(`owner-admin ${action}: ${code}${status ? ` (HTTP ${status})` : ''}`)
    this.name = 'AdminApiError'
    this.action = action
    this.code = code
    this.status = status
    this.serverCode = serverCode
  }
}

export type InvokeOptions = { body: Record<string, unknown> }
export type InvokeResult = { data: unknown; error: unknown; response?: Response }
/** Shape of supabase.functions.invoke, injected so tests need no network. */
export type Invoke = (functionName: string, options: InvokeOptions) => Promise<InvokeResult>

// ---------------------------------------------------------------------------
// Response schemas (data of `{ ok: true, data }`).
// ---------------------------------------------------------------------------

/** PostgreSQL counts arrive as JSON numbers; accept digit strings too. */
const count = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])

const settingsSchema = z.object({
  posting_enabled: z.boolean(),
  public_reads_enabled: z.boolean(),
  updated_at: z.string().optional(),
})

/** admin_status() (supabase/migrations/0050_service_rpcs.sql). */
export const statusSchema = z.object({
  last_maintenance_at: z.string().nullable(),
  last_maintenance_result: z.unknown().optional(),
  live_posts: count,
  live_notices: count,
  storage_objects: count,
  storage_bytes: count,
  settings: settingsSchema.nullable(),
})
export type AdminStatus = z.output<typeof statusSchema>

/** One row of admin_list_accounts(). The owner row has no org. */
export const accountRowSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  is_owner: z.boolean(),
  account_active: z.boolean(),
  org_id: z.string().nullable(),
  org_name: z.string().nullable(),
  org_slug: z.string().nullable(),
  org_type: z.enum(ORG_TYPES).nullable(),
  org_campus: z.enum(CAMPUSES).nullable(),
  org_active: z.boolean().nullable(),
  created_at: z.string(),
  last_sign_in_at: z.string().nullable(),
  banned_until: z.string().nullable(),
  factor_count: count,
  newest_factor_at: z.string().nullable(),
  live_posts: count,
})
export type AccountRow = z.output<typeof accountRowSchema>

const passwordSchema = z.object({ password: z.string().min(1) })
const createdSchema = z.object({
  userId: z.string(),
  orgId: z.string(),
  username: z.string(),
  password: z.string().min(1),
})

/** `{}` per the contract; the action already happened, so any data is accepted. */
const done = z.unknown().transform((): void => undefined)

/** Optional counters (`{ removed }`, `{ removedFiles }`): the action already
 * happened, so a missing counter is reported as null instead of an error. */
const counter = (key: string) =>
  z.unknown().transform((value): number | null => {
    const n = isRecord(value) ? value[key] : undefined
    return typeof n === 'number' ? n : null
  })

// ---------------------------------------------------------------------------
// Error mapping.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Matched by name, not instanceof, so a second copy of functions-js still maps. */
function nameOf(err: unknown): string {
  if (typeof err !== 'object' || err === null) return ''
  const name = (err as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

function responseOf(value: unknown): Response | null {
  return value && typeof (value as Response).text === 'function' && typeof (value as Response).status === 'number'
    ? (value as Response)
    : null
}

/** Without a contract body, only statuses with an unambiguous meaning map to a
 * code. A bare 403 or 404 could come from a gateway or a missing function, so
 * it must never be read as "not the owner" or "account not found". */
function codeFromStatus(status: number | null): AdminErrorCode {
  if (status === null) return 'unknown'
  if (status === 400) return 'bad_request'
  if (status === 401) return 'unauthorized'
  if (status === 402) return 'service_restricted'
  if (status === 404) return 'unavailable'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (status >= 501 && status <= 504) return 'unavailable'
  if (status >= 500) return 'internal'
  return 'unknown'
}

function classify(serverError: unknown, status: number | null): { code: AdminErrorCode; serverCode: string | null } {
  if (typeof serverError === 'string' && (SERVER_ERROR_CODES as readonly string[]).includes(serverError)) {
    return { code: serverError as ServerErrorCode, serverCode: null }
  }
  // Keep a short machine code (never free text) so the owner can report it.
  const serverCode = typeof serverError === 'string' && /^[a-z0-9_]{1,40}$/.test(serverError) ? serverError : null
  return { code: codeFromStatus(status), serverCode }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text()
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/** Maps the error half of a functions.invoke result. */
export async function toAdminError(action: AdminAction, error: unknown, response?: Response): Promise<AdminApiError> {
  const name = nameOf(error)
  if (name === 'FunctionsFetchError') return new AdminApiError(action, 'network')
  const res = responseOf((error as { context?: unknown } | null)?.context) ?? responseOf(response)
  const status = res?.status ?? null
  if (name === 'FunctionsRelayError') return new AdminApiError(action, 'unavailable', status)
  if (name === 'FunctionsHttpError') {
    const body = res ? await readJson(res) : null
    const { code, serverCode } = classify(isRecord(body) ? body.error : undefined, status)
    return new AdminApiError(action, code, status, serverCode)
  }
  if (error instanceof TypeError) return new AdminApiError(action, 'network')
  // functions-js returns the parse error itself when a 2xx body isn't valid JSON.
  if (error instanceof SyntaxError) return new AdminApiError(action, 'bad_response', status)
  return new AdminApiError(action, 'unknown', status)
}

type Envelope = { ok: true; data: unknown } | { ok: false; error: unknown }

function envelope(data: unknown): Envelope | null {
  let value = data
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!isRecord(value) || typeof value.ok !== 'boolean') return null
  return value.ok ? { ok: true, data: value.data } : { ok: false, error: value.error }
}

// ---------------------------------------------------------------------------
// The API.
// ---------------------------------------------------------------------------

export type OrgUpdate = {
  orgId: string
  name: string
  slug: string
  type: OrgType
  campus: Campus
  active: boolean
}

export type NewAccount = {
  username: string
  orgName: string
  orgSlug: string
  type: OrgType
  campus: Campus
}

export function createAdminApi(invoke: Invoke) {
  async function call<T>(action: AdminAction, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    let result: InvokeResult
    try {
      // `action` last, so a parameter can never replace it.
      result = await invoke(OWNER_ADMIN_FUNCTION, { body: { ...params, action } })
    } catch (err) {
      throw await toAdminError(action, err)
    }
    if (result.error) throw await toAdminError(action, result.error, result.response)

    const status = result.response?.status ?? null
    const env = envelope(result.data)
    if (!env) throw new AdminApiError(action, 'bad_response', status)
    if (!env.ok) {
      const { code, serverCode } = classify(env.error, null)
      throw new AdminApiError(action, code, status, serverCode)
    }
    const parsed = schema.safeParse(env.data)
    if (!parsed.success) throw new AdminApiError(action, 'bad_response', status)
    return parsed.data
  }

  return {
    status: () => call('status', {}, statusSchema),
    listAccounts: () => call('list_accounts', {}, z.array(accountRowSchema)),
    createAccount: (input: NewAccount) =>
      call(
        'create_account',
        { username: input.username, orgName: input.orgName, orgSlug: input.orgSlug, type: input.type, campus: input.campus },
        createdSchema,
      ),
    resetPassword: (userId: string) => call('reset_password', { userId }, passwordSchema),
    handover: (userId: string) => call('handover', { userId }, passwordSchema),
    setAccountActive: (userId: string, active: boolean) => call('set_account_active', { userId, active }, done),
    updateOrg: (org: OrgUpdate) =>
      call(
        'update_org',
        { orgId: org.orgId, name: org.name, slug: org.slug, type: org.type, campus: org.campus, active: org.active },
        done,
      ),
    removeFactors: (userId: string) => call('remove_factors', { userId }, counter('removed')),
    deleteAccount: (userId: string) => call('delete_account', { userId }, counter('removedFiles')),
    deletePost: (postId: string) => call('delete_post', { postId }, counter('removedFiles')),
    removePostImage: (postId: string) => call('remove_post_image', { postId }, counter('removedFiles')),
  }
}

export type AdminApi = ReturnType<typeof createAdminApi>
