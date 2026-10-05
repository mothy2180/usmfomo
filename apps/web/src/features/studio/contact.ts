/** The owner's contact channel (VITE_CONTACT_URL, set at build time) as a
 * link target: only https: or mailto:; anything else, or empty, is no link. */
export function contactHref(url: string): string | null {
  const value = url.trim()
  return /^(https:\/\/\S+|mailto:\S+)$/i.test(value) ? value : null
}
