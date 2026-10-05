const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Same rule as the orgs_slug_format CHECK (0010).
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/

/** Post ids are UUIDs; anything else can't exist, so don't ask the database. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function isOrgSlug(value: string): boolean {
  return SLUG_RE.test(value)
}
