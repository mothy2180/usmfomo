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
 * name, injected by the platform). We always use "default". The legacy
 * SUPABASE_SERVICE_ROLE_KEY is never read: new projects do not have one.
 */
export function parseSecretKeys(raw: string | undefined): string {
  if (!raw) throw new Error('SUPABASE_SECRET_KEYS is not set')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('SUPABASE_SECRET_KEYS is not valid JSON')
  }
  const key = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).default : undefined
  if (typeof key !== 'string' || !key.startsWith('sb_secret_')) {
    throw new Error('SUPABASE_SECRET_KEYS has no "default" secret key')
  }
  return key
}
