// Pure helpers for the TOTP screens (no client, so they are unit-testable).

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP" (easier to type by hand). */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')
}

/** Only an otpauth://totp/ URI may become a link (never javascript: or http:). */
export function isOtpauthUri(uri: string): boolean {
  return /^otpauth:\/\/totp\/[^\s]+$/.test(uri)
}

/** Supabase Auth returns the QR code as an SVG data URI. */
export function isSvgDataUri(src: string): boolean {
  return src.startsWith('data:image/svg+xml')
}

/** Digits only; people paste "123 456" or "123-456". */
export function normaliseCode(input: string): string {
  return input.replace(/[\s-]+/g, '')
}

export function isSixDigitCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

/** Device names must be unique per account (Supabase rejects duplicates). */
export function validateDeviceName(name: string, existing: readonly string[]): string | null {
  const n = name.trim()
  if (!n) return 'Give the device a name, for example "Phone".'
  if (n.length > 40) return 'Use at most 40 characters.'
  if (existing.some((e) => e.trim().toLowerCase() === n.toLowerCase())) return 'You already have a device with that name.'
  return null
}
