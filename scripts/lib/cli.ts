// The owner CLI as a function: argv + environment in, exit code out.
// Exit codes: 0 done, 1 failed, 2 bad command line.
import { generatePassword } from '../../supabase/functions/_shared/password.ts'
import { chosenPassword, parseCommand, USAGE, UsageError } from './args.ts'
import { type Io, runCommand } from './commands.ts'
import { describeFailure } from './format.ts'
import { createCliPort } from './port.ts'
import { createRestClient } from './rest.ts'
import { type Env, readLocalStatus, resolveTarget } from './target.ts'

export type CliContext = {
  env: Env
  io: Io
  fetch?: typeof fetch
  readLocalStatus?: () => string
  generatePassword?: () => string
  /** All of stdin, for --password-stdin. */
  readStdin?: () => Promise<string>
  now?: () => Date
}

/** stdin as text. A terminal is refused: what the owner typed would show on screen. */
export async function readPipedStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new UsageError(
      `--password-stdin reads a pipe, not the terminal: read -rs 'p?New password: '; echo; printf %s "$p" | pnpm account ... --password-stdin; unset p`,
    )
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

export async function main(argv: readonly string[], ctx: CliContext): Promise<number> {
  const { io } = ctx
  let command
  let password: string | undefined
  try {
    command = parseCommand(argv)
    if ('passwordStdin' in command && command.passwordStdin) {
      password = chosenPassword(await (ctx.readStdin ?? readPipedStdin)())
    }
  } catch (err) {
    if (!(err instanceof UsageError)) throw err
    io.err(`error: ${err.message}`)
    io.err('run "pnpm account --help" for the commands')
    return 2
  }
  if (command.name === 'help') {
    io.out(USAGE)
    return 0
  }

  try {
    const target = resolveTarget(ctx.env, ctx.readLocalStatus ?? readLocalStatus)
    // Say which project is about to change (never the key).
    io.err(`supabase: ${target.url}${target.local ? ' (local stack)' : ''}`)
    const port = createCliPort(createRestClient(target, ctx.fetch ?? fetch))
    await runCommand(command, {
      port,
      io,
      generatePassword: ctx.generatePassword ?? generatePassword,
      password,
      local: target.local,
      now: ctx.now,
    })
    return 0
  } catch (err) {
    io.err(`error: ${describeFailure(err)}`)
    return 1
  }
}
