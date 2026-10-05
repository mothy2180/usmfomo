// Command line of the owner CLI (docs/api.md, "Owner CLI"). Usernames and new
// organisations are validated with the shared schemas the owner console uses.
import { parseArgs } from 'node:util'
import { createAccountSchema, slugify, usernameSchema } from '../../packages/shared/src/schemas.ts'
import type { CreateAccountInput } from '../../supabase/functions/owner-admin/request.ts'

export const USAGE = `usage: pnpm account <command> [args]

commands:
  list                         every account: status, 2FA factors, live posts, last sign-in
  create-owner <username>      the owner account (enrol two TOTP devices right after)
  create <username> --org "<name>" --type club|school [--campus main] [--slug <slug>]
                               a club or school account; the slug defaults to one made from --org
  reset-password <username>    new password; ends every session of that account
  handover <username>          new committee: new password, 2FA removed, every session ended
  deactivate <username>        stop sign-in and posting
  activate <username>          undo deactivate
  remove-factors <username>    delete every 2FA factor of a club or school account
  delete <username> --yes      delete a club or school account, its organisation, posts and posters
  owner-reset-mfa <username>   break-glass: new owner password and every owner 2FA factor removed
  seed-local                   local stack only: an owner and two demo accounts

environment:
  SUPABASE_URL           project URL (default http://127.0.0.1:54321)
  SUPABASE_SECRET_KEY    secret API key; may be omitted for the local stack

Passwords are printed once and never written to disk.`

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export type AccountCommand =
  | 'reset-password'
  | 'handover'
  | 'deactivate'
  | 'activate'
  | 'remove-factors'
  | 'owner-reset-mfa'

export type Command =
  | { name: 'help' }
  | { name: 'list' }
  | { name: 'seed-local' }
  | { name: 'create-owner'; username: string }
  | { name: 'create'; input: CreateAccountInput }
  | { name: AccountCommand; username: string }
  | { name: 'delete'; username: string; yes: boolean }

type OptionName = 'org' | 'type' | 'campus' | 'slug' | 'yes'

type Spec = { args: readonly string[]; options: readonly OptionName[] }

const USER: Spec = { args: ['<username>'], options: [] }

// A Map, so that names such as "toString" are not found on Object.prototype.
const SPECS: ReadonlyMap<string, Spec> = new Map<string, Spec>([
  ['list', { args: [], options: [] }],
  ['seed-local', { args: [], options: [] }],
  ['create-owner', USER],
  ['create', { args: ['<username>'], options: ['org', 'type', 'campus', 'slug'] }],
  ['reset-password', USER],
  ['handover', USER],
  ['deactivate', USER],
  ['activate', USER],
  ['remove-factors', USER],
  ['owner-reset-mfa', USER],
  ['delete', { args: ['<username>'], options: ['yes'] }],
])

const USERNAME_RULE =
  '3-32 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit'

function username(raw: string): string {
  const parsed = usernameSchema.safeParse(raw)
  if (!parsed.success) throw new UsageError(`invalid username "${raw}": ${USERNAME_RULE}`)
  return parsed.data
}

/** One readable message for the first problem createAccountSchema found. */
function createProblem(path: PropertyKey | undefined, slugGiven: boolean): string {
  switch (path) {
    case 'username':
      return `invalid username: ${USERNAME_RULE}`
    case 'orgName':
      return '--org must be 2-100 characters without control characters'
    case 'orgSlug':
      return slugGiven
        ? '--slug must be 1-50 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit'
        : 'cannot make a URL slug from --org; pass one with --slug'
    case 'type':
      return '--type must be club or school'
    case 'campus':
      return '--campus must be main, engineering, health or other'
    default:
      return 'invalid account details'
  }
}

function parseCreate(name: string, values: Partial<Record<OptionName, string | boolean>>): CreateAccountInput {
  const org = values.org
  const type = values.type
  if (typeof org !== 'string' || typeof type !== 'string') {
    throw new UsageError('create needs --org "<name>" and --type club|school')
  }
  const slug = typeof values.slug === 'string' ? values.slug : slugify(org)
  const parsed = createAccountSchema.safeParse({
    username: name,
    orgName: org,
    orgSlug: slug,
    type,
    campus: typeof values.campus === 'string' ? values.campus : 'main',
  })
  if (!parsed.success) {
    throw new UsageError(createProblem(parsed.error.issues[0]?.path[0], typeof values.slug === 'string'))
  }
  // The schema's refine() narrows campus: organisations have a physical campus.
  return parsed.data
}

const PARSE_CONFIG = {
  allowPositionals: true,
  strict: true,
  options: {
    org: { type: 'string' },
    type: { type: 'string' },
    campus: { type: 'string' },
    slug: { type: 'string' },
    yes: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
} as const

function parse(argv: readonly string[]) {
  try {
    return parseArgs({ ...PARSE_CONFIG, args: [...argv] })
  } catch (err) {
    // Unknown options and missing option values.
    throw new UsageError(err instanceof Error ? err.message : 'invalid arguments')
  }
}

export function parseCommand(argv: readonly string[]): Command {
  const { values, positionals } = parse(argv)
  const [name, ...args] = positionals
  if (values.help || name === 'help') return { name: 'help' }
  if (name === undefined) throw new UsageError('missing command')

  const spec = SPECS.get(name)
  if (!spec) throw new UsageError(`unknown command "${name}"`)
  if (args.length !== spec.args.length) {
    throw new UsageError(`usage: pnpm account ${[name, ...spec.args].join(' ')}`)
  }
  for (const option of ['org', 'type', 'campus', 'slug', 'yes'] as const) {
    if (values[option] !== undefined && !spec.options.includes(option)) {
      throw new UsageError(`--${option} does not apply to "${name}"`)
    }
  }

  const [first = ''] = args
  switch (name) {
    case 'list':
    case 'seed-local':
      return { name }
    case 'create-owner':
      return { name, username: username(first) }
    case 'create':
      return { name, input: parseCreate(first, values) }
    case 'delete':
      return { name, username: username(first), yes: values.yes === true }
    case 'reset-password':
    case 'handover':
    case 'deactivate':
    case 'activate':
    case 'remove-factors':
    case 'owner-reset-mfa':
      return { name, username: username(first) }
    default:
      throw new UsageError(`unknown command "${name}"`)
  }
}
