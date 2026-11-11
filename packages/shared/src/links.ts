// Mirrors the posts/notices link_url CHECK: https only, no userinfo (no
// "trusted.host@evil.example" tricks), ASCII host (IDNs must be punycode), no
// whitespace or control characters, at most 300 characters.
export const LINK_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^\s\p{Cc}]*)?$/u

// Mirrors the posts contact_email CHECK (0057): ASCII only (an internationalised
// domain must be punycode), no spaces or line breaks, at most 254 characters.
export const CONTACT_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/

export function isContactEmail(value: string): boolean {
  return value.length <= 254 && CONTACT_EMAIL_RE.test(value)
}

export function isSafeHttpsUrl(value: string): boolean {
  return value.length <= 300 && LINK_URL_RE.test(value)
}

/** Hostname shown next to every link so students can spot look-alikes.
 * URL() returns IDNs as xn-- punycode, which is what we want to display. */
export function displayHostname(value: string): string | null {
  if (!isSafeHttpsUrl(value)) return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

export const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow ugc'
