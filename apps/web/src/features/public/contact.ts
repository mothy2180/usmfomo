/** The owner's contact channel (VITE_CONTACT_URL, set at build time) as a
 * link target: only https: or mailto:, anything else (or empty) = no link. */
export function contactHref(url: string): string | null {
  const value = url.trim()
  return /^(https:\/\/[^\s]+|mailto:[^\s]+)$/i.test(value) ? value : null
}
