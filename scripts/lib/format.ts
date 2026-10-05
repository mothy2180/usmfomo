// Output of the owner CLI: the account table and one-line failure messages.
// Times are shown in Malaysia time like everywhere else in usmfomo.
import { isoToMytInput } from '../../packages/shared/src/time.ts'
import { HttpError } from '../../supabase/functions/_shared/http.ts'
import type { AccountRow } from '../../supabase/functions/owner-admin/types.ts'
import { UsageError } from './args.ts'
import { ApiError } from './rest.ts'
import { ConfigError } from './target.ts'

/** An expected failure with a message written for the owner. */
export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}

const ORG_COLUMN_MAX = 40

function mytTime(iso: string | null): string {
  if (!iso) return 'never'
  const { date, time } = isoToMytInput(iso)
  return `${date} ${time}`
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

export function accountStatus(row: AccountRow, now: Date): string {
  const status = !row.account_active ? 'inactive' : row.org_active === false ? 'org inactive' : 'active'
  const banned = row.banned_until !== null && Date.parse(row.banned_until) > now.getTime()
  return banned ? `${status}, banned` : status
}

export function formatAccounts(rows: readonly AccountRow[], now: Date = new Date()): string {
  if (rows.length === 0) return 'No accounts yet. Create the owner with: pnpm account create-owner <username>'
  const header = ['USERNAME', 'KIND', 'ORGANISATION', 'SLUG', 'CAMPUS', 'STATUS', '2FA', 'LIVE', 'LAST SIGN-IN (MYT)']
  const lines = rows.map((r) => [
    r.username,
    r.is_owner ? 'owner' : (r.org_type ?? '-'),
    truncate(r.org_name ?? '-', ORG_COLUMN_MAX),
    r.org_slug ?? '-',
    r.org_campus ?? '-',
    accountStatus(r, now),
    String(r.factor_count),
    r.is_owner ? '-' : String(r.live_posts),
    mytTime(r.last_sign_in_at),
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => (l[i] ?? '').length)))
  const render = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd()
  const owners = rows.filter((r) => r.is_owner).length
  const clubs = rows.filter((r) => r.org_type === 'club').length
  const schools = rows.filter((r) => r.org_type === 'school').length
  return [
    render(header),
    ...lines.map(render),
    '',
    `${rows.length} account(s): ${owners} owner, ${clubs} club, ${schools} school`,
  ].join('\n')
}

const CONSTRAINTS: Readonly<Record<string, string>> = {
  orgs_slug_key: 'an organisation with this slug already exists (choose another --slug)',
  orgs_name_unique: 'an organisation with this name already exists',
  accounts_username_key: 'this username is already taken',
  accounts_pkey: 'this sign-in already belongs to an account',
}

function describeApiError(err: ApiError): string {
  if (err.status === 0) return err.message
  if (err.service === 'auth') {
    if (err.code === 'email_exists' || err.code === 'user_already_exists') {
      return 'a sign-in for this username already exists'
    }
    if (err.code === 'not_admin' || err.code === 'bad_jwt' || err.code === 'no_authorization' || err.status === 401) {
      return 'the API key was refused: SUPABASE_SECRET_KEY must be a secret key of this project'
    }
  }
  if (err.service === 'rest') {
    if (err.code === '42501' || err.status === 401) {
      return 'the API key was refused: SUPABASE_SECRET_KEY must be a secret key of this project'
    }
    if (err.code === '23505') {
      const constraint = /constraint "([a-z0-9_]+)"/.exec(err.message)?.[1] ?? ''
      return CONSTRAINTS[constraint] ?? 'this already exists'
    }
    if (err.code === 'P0001' && /_not_found$/.test(err.message)) return 'no such account or organisation'
    if (err.code === 'PGRST202') return 'the admin_* database functions are missing: are the migrations applied?'
  }
  const code = err.code ? ` ${err.code}` : ''
  return `${err.service} API answered ${err.status}${code}: ${err.message}`
}

/** A one-line, secret-free description of any failure. */
export function describeFailure(err: unknown): string {
  if (err instanceof CliError || err instanceof UsageError || err instanceof ConfigError) return err.message
  if (err instanceof ApiError) return describeApiError(err)
  if (err instanceof HttpError) {
    switch (err.code) {
      case 'not_found':
        return 'no such account'
      case 'forbidden':
        return 'this command is for club and school accounts, not the owner account'
      default:
        return 'the operation stopped part-way; run the command again'
    }
  }
  return `unexpected error: ${err instanceof Error ? err.message : String(err)}`
}
