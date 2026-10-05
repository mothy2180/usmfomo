// Constant-time secret comparison for the maintenance function's x-cron-secret.

/**
 * Compares two byte arrays without an early exit. Only meaningful for arrays
 * of equal length; arrays of different lengths are simply unequal.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Production secrets come from `openssl rand -hex 32` (64 characters). */
export const MIN_SECRET_LENGTH = 32

const encoder = new TextEncoder()

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/**
 * True when `provided` equals the configured secret. Both values are hashed
 * first, so the comparison always runs over two 32-byte arrays: it neither
 * exits early nor reveals the secret's length. A missing or short configured
 * secret never matches anything.
 */
export async function secretMatches(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < MIN_SECRET_LENGTH) return false
  const [a, b] = await Promise.all([sha256(provided ?? ''), sha256(expected)])
  return timingSafeEqual(a, b)
}
