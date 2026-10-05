// Generated account passwords (docs/api.md): 24 characters from
// crypto.getRandomValues, no look-alikes (0 O 1 l I), always at least one
// lowercase letter, one uppercase letter and one digit, which satisfies the
// Auth setting password_requirements = lower_upper_letters_digits.
//
// Plain TypeScript with no runtime-specific imports: the owner CLI
// (scripts/account.ts, Node) imports this file too.

export const PASSWORD_LENGTH = 24
export const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz'
export const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
export const PASSWORD_DIGITS = '23456789'
export const PASSWORD_ALPHABET = PASSWORD_LOWER + PASSWORD_UPPER + PASSWORD_DIGITS

/** Fills the array with random bytes and returns it (crypto.getRandomValues). */
export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

const secureFill: RandomFill = (bytes) => crypto.getRandomValues(bytes)

// Rejection sampling: bytes at or above the largest multiple of the alphabet
// size are skipped, so every character is equally likely.
const SAMPLE_LIMIT = 256 - (256 % PASSWORD_ALPHABET.length)
const DRAW_BYTES = 48
// About 2.7 % of candidates lack a class, so 100 draws (~190 candidates) never
// run out with a working random source; a broken one fails fast.
const MAX_DRAWS = 100

export function hasRequiredClasses(password: string): boolean {
  return /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password)
}

export function generatePassword(fill: RandomFill = secureFill): string {
  let candidate = ''
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    for (const byte of fill(new Uint8Array(DRAW_BYTES))) {
      if (byte >= SAMPLE_LIMIT) continue
      candidate += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]
      if (candidate.length < PASSWORD_LENGTH) continue
      if (hasRequiredClasses(candidate)) return candidate
      // Start a fresh candidate (never patch characters in), so the result
      // stays uniform over all valid passwords.
      candidate = ''
    }
  }
  throw new Error('password generator failed')
}
