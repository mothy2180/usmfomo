// Which Supabase project the owner CLI talks to, and with which key.
//   SUPABASE_URL         default http://127.0.0.1:54321 (the local stack)
//   SUPABASE_SECRET_KEY  a secret API key (sb_secret_…); for the local stack it
//                        may be omitted and is read from `supabase status`.
// The key is never printed, logged or written anywhere.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:54321'

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])
const SECRET_KEY_RE = /^sb_secret_[A-Za-z0-9_-]+$/

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type Target = { url: string; key: string; local: boolean }

export type Env = Readonly<Record<string, string | undefined>>

/** The project origin; plain http is allowed for the local stack only. */
export function parseSupabaseUrl(raw: string): { url: string; local: boolean } {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new ConfigError('SUPABASE_URL is not a valid URL')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ConfigError('SUPABASE_URL must be an http(s) URL')
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw new ConfigError('SUPABASE_URL must be the project URL only, such as https://<ref>.supabase.co')
  }
  const local = LOCAL_HOSTS.has(u.hostname)
  if (!local && u.protocol !== 'https:') throw new ConfigError('SUPABASE_URL must use https:// for a hosted project')
  return { url: u.origin, local }
}

/** Parses `supabase status -o env` output (KEY="value" lines). */
export function parseStatusEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (!match) continue
    const [, name = '', raw = ''] = match
    const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0]
    values[name] = quoted ? raw.slice(1, -1) : raw
  }
  return values
}

/** Runs `pnpm -s supabase status -o env` in the repository root. */
export function readLocalStatus(): string {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  return execFileSync('pnpm', ['-s', 'supabase', 'status', '-o', 'env'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60_000,
  })
}

export function resolveTarget(env: Env, readStatus: () => string = readLocalStatus): Target {
  const { url, local } = parseSupabaseUrl(env.SUPABASE_URL || DEFAULT_SUPABASE_URL)
  let key = env.SUPABASE_SECRET_KEY?.trim() ?? ''
  if (!key) {
    if (!local) {
      throw new ConfigError(
        `SUPABASE_SECRET_KEY is required for ${url}: pass the owner-cli secret key for one command (docs/api.md)`,
      )
    }
    let status: string
    try {
      status = readStatus()
    } catch {
      throw new ConfigError('could not read the local keys with "pnpm supabase status"; is the local stack running?')
    }
    key = parseStatusEnv(status).SECRET_KEY ?? ''
    if (!key) throw new ConfigError('"pnpm supabase status" printed no SECRET_KEY; is the local stack running?')
  }
  if (!SECRET_KEY_RE.test(key)) {
    throw new ConfigError('SUPABASE_SECRET_KEY must be a secret API key (sb_secret_...); legacy JWT keys are refused')
  }
  return { url, key, local }
}
