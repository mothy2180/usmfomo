// What each owner CLI command does. Account changes shared with the owner
// console (create, handover, rename, delete, activation) run the Edge
// Function's own logic (owner-admin/actions.ts) on the CLI's fetch port.
//
// The CLI is also the break-glass for the owner account, so unlike the
// console it can reset the owner's password (docs/runbooks/owner-lockout.md)
// and deactivate or activate it.
//
// A command finds its account with a direct lookup by username, never by
// searching the account list.
import { usernameToEmail } from '../../packages/shared/src/supabase.ts'
import {
  createAccount,
  deleteAccount,
  handover,
  renameAccount,
  setActive,
  setPassword,
} from '../../supabase/functions/owner-admin/actions.ts'
import type { CreateAccountInput } from '../../supabase/functions/owner-admin/request.ts'
import type { AccountRow } from '../../supabase/functions/owner-admin/types.ts'
import { HttpError } from '../../supabase/functions/_shared/http.ts'
import type { Command } from './args.ts'
import { CliError, formatAccounts } from './format.ts'
import type { CliPort } from './port.ts'

export type Io = {
  out(line: string): void
  err(line: string): void
}

export type CommandDeps = {
  port: CliPort
  io: Io
  generatePassword: () => string
  /** A password the owner gave (--password-stdin, already checked): used instead of a generated one. */
  password?: string
  /** The target is the local stack (seed-local refuses anything else). */
  local: boolean
  now?: () => Date
}

export const SEED_OWNER = 'owner'
export const SEED_ACCOUNTS: readonly CreateAccountInput[] = [
  { username: 'demo-club', orgName: 'Demo Club', orgSlug: 'demo-club', type: 'club', campus: 'main' },
  { username: 'demo-school', orgName: 'Demo School', orgSlug: 'demo-school', type: 'school', campus: 'main' },
]

/** The new password: a generated one is shown once, one the owner gave is never echoed. */
function newPassword(deps: CommandDeps): string {
  return deps.password ?? deps.generatePassword()
}

function printPassword(deps: CommandDeps, password: string): void {
  if (deps.password !== undefined) {
    deps.io.out('  password: the one you gave (not shown)')
    return
  }
  deps.io.out(`  password: ${password}`)
  deps.io.out('  (shown once and saved nowhere: put it in a password manager now)')
}

async function requireAccount(port: CliPort, username: string): Promise<AccountRow> {
  const row = await port.getAccountByUsername(username)
  if (!row) throw new CliError(`no account named "${username}" (see: pnpm account list)`)
  return row
}

async function requireClubAccount(port: CliPort, username: string, ownerHint: string): Promise<AccountRow> {
  const row = await requireAccount(port, username)
  if (row.is_owner) throw new CliError(`"${username}" is the owner account: ${ownerHint}`)
  return row
}

async function createOwner(deps: CommandDeps, username: string): Promise<void> {
  const { port, io } = deps
  if (await port.getAccountByUsername(username)) throw new CliError(`an account named "${username}" already exists`)
  const password = newPassword(deps)
  const userId = await port.createAuthUser(usernameToEmail(username), password)
  try {
    await port.linkOwner(userId, username)
  } catch (err) {
    // No half-created owner: remove the sign-in again.
    try {
      await port.deleteAuthUser(userId)
    } catch {
      io.err(`warning: could not remove the half-created sign-in ${userId}; delete it in Studio > Authentication`)
    }
    throw err
  }
  io.out(`Created the owner account "${username}".`)
  printPassword(deps, password)
}

async function create(deps: CommandDeps, input: CreateAccountInput): Promise<void> {
  const created = await createAccount(deps, input, deps.password)
  deps.io.out(
    `Created the ${input.type} account "${created.username}" for ${input.orgName} ` +
      `(slug ${input.orgSlug}, campus ${input.campus}).`,
  )
  printPassword(deps, created.password)
}

async function resetPassword(deps: CommandDeps, username: string): Promise<void> {
  const row = await requireAccount(deps.port, username)
  const password = newPassword(deps)
  // A new password ends every session of the account.
  await setPassword(deps.port, row.user_id, password)
  deps.io.out(`New password for "${username}"; every session of this account has ended.`)
  printPassword(deps, password)
}

async function handOver(deps: CommandDeps, username: string): Promise<void> {
  const row = await requireClubAccount(deps.port, username, 'use reset-password instead')
  const { password } = await handover(deps, row.user_id, deps.password)
  deps.io.out(`Handed over "${username}": new password, every session ended.`)
  printPassword(deps, password)
}

async function rename(deps: CommandDeps, username: string, newUsername: string): Promise<void> {
  const { port, io } = deps
  const row = await requireClubAccount(port, username, 'its username cannot be changed with this tool')
  if (newUsername === username) {
    io.out(`"${username}" already has this username; nothing changed.`)
    return
  }
  const other = await port.getAccountByUsername(newUsername)
  if (other) {
    throw new CliError(`"${newUsername}" is already taken${other.org_name ? ` by ${other.org_name}` : ''}`)
  }
  await renameAccount(port, row.user_id, newUsername)
  io.out(`Renamed "${username}" to "${newUsername}". ${row.org_name ?? 'The account'} signs in with "${newUsername}" from now on;`)
  io.out('  sessions that are already signed in keep working. Tell the committee through its official channel.')
}

async function setAccountActive(deps: CommandDeps, username: string, active: boolean): Promise<void> {
  const row = await requireAccount(deps.port, username)
  await setActive(deps.port, row.user_id, active)
  if (active) {
    deps.io.out(`"${username}" is active again.`)
  } else {
    deps.io.out(`"${username}" is deactivated: it can no longer sign in, and posting stopped at once.`)
    if (row.is_owner) deps.io.out(`Owner console access is off until: pnpm account activate ${username}`)
  }
}

async function remove(deps: CommandDeps, username: string, yes: boolean): Promise<void> {
  const { port, io } = deps
  const row = await requireClubAccount(port, username, 'the owner account cannot be deleted with this tool')
  const what = `"${username}" (${row.org_name ?? 'no organisation'}, ${row.live_posts} live post(s))`
  if (!yes) {
    throw new CliError(`this deletes ${what} with all its posts and poster files; add --yes to confirm`)
  }
  const result = await deleteAccount(port, row.user_id).catch((err: unknown) => {
    if (err instanceof HttpError && err.code === 'internal') {
      throw new CliError(
        'some poster files could not be removed, so the account was kept (deactivated); run the command again',
      )
    }
    throw err
  })
  io.out(`Deleted ${what} and ${result.removedFiles} poster file(s).`)
}

async function seedLocal(deps: CommandDeps): Promise<void> {
  const { port, io } = deps
  if (!deps.local) throw new CliError('seed-local only runs against the local stack (SUPABASE_URL on 127.0.0.1)')
  const exists = async (name: string) => (await port.getAccountByUsername(name)) !== null
  const skip = (name: string) =>
    io.out(`"${name}" already exists, skipped (run "pnpm account reset-password ${name}" for a new password)`)

  if (await exists(SEED_OWNER)) skip(SEED_OWNER)
  else await createOwner(deps, SEED_OWNER)
  for (const input of SEED_ACCOUNTS) {
    if (await exists(input.username)) skip(input.username)
    else await create(deps, input)
  }
}

export async function runCommand(cmd: Command, deps: CommandDeps): Promise<void> {
  switch (cmd.name) {
    case 'help':
      return
    case 'list':
      deps.io.out(formatAccounts(await deps.port.listAccounts(), deps.now?.() ?? new Date()))
      return
    case 'create-owner':
      return await createOwner(deps, cmd.username)
    case 'create':
      return await create(deps, cmd.input)
    case 'reset-password':
      return await resetPassword(deps, cmd.username)
    case 'handover':
      return await handOver(deps, cmd.username)
    case 'rename':
      return await rename(deps, cmd.username, cmd.newUsername)
    case 'deactivate':
      return await setAccountActive(deps, cmd.username, false)
    case 'activate':
      return await setAccountActive(deps, cmd.username, true)
    case 'delete':
      return await remove(deps, cmd.username, cmd.yes)
    case 'seed-local':
      return await seedLocal(deps)
  }
}
