// Environment access. Error messages name the variable, never its value.

export type EnvReader = (name: string) => string | undefined

export const denoEnv: EnvReader = (name) => Deno.env.get(name)

export function requireEnv(read: EnvReader, name: string): string {
  const value = read(name)
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/**
 * The secret API key from SUPABASE_SECRET_KEYS (a JSON object keyed by key
 * name, injected by the platform): the key named "default", or else the only
 * secret key there is, such as a replacement created under another name.
 * Several secret keys and none named "default" is an error, since nothing says
 * which one is meant. The legacy SUPABASE_SERVICE_ROLE_KEY is never read: new
 * projects do not have one.
 */
export function parseSecretKeys(raw: string | undefined): string {
  if (!raw) throw new Error('SUPABASE_SECRET_KEYS is not set')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('SUPABASE_SECRET_KEYS is not valid JSON')
  }
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  const isSecretKey = (value: unknown): value is string => typeof value === 'string' && value.startsWith('sb_secret_')
  if (Object.hasOwn(keys, 'default')) {
    if (!isSecretKey(keys.default)) throw new Error('SUPABASE_SECRET_KEYS has no "default" secret key')
    return keys.default
  }
  const secretKeys = Object.values(keys).filter(isSecretKey)
  if (secretKeys.length === 0) throw new Error('SUPABASE_SECRET_KEYS has no secret key')
  if (secretKeys.length > 1) {
    throw new Error('SUPABASE_SECRET_KEYS has several secret keys and none is named "default"')
  }
  return secretKeys[0]
}

/** The local stack's hosts: its gateway inside Docker, or this machine. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['kong', '127.0.0.1', 'localhost', '[::1]', 'host.docker.internal'])

/**
 * True when SUPABASE_URL is the local stack's (plain http to a local host, such
 * as http://kong:8000). A hosted project's is always https://<ref>.supabase.co,
 * and the platform sets it: `supabase secrets set` cannot change SUPABASE_*.
 */
export function isLocalSupabaseUrl(raw: string | undefined): boolean {
  if (!raw) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
}
