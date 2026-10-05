// Mirrors the posts/notices link_url CHECK: https only, no userinfo (no
// "trusted.host@evil.example" tricks), ASCII host (IDNs must be punycode), no
// whitespace or control characters, at most 300 characters.
export const LINK_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^\s\p{Cc}]*)?$/u

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
