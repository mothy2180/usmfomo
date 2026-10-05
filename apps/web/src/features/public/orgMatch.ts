import type { OrgType } from '@usmfomo/shared/config'

/** Lower-case, accents removed, single spaces: "Persatuan Élite " -> "persatuan elite". */
export function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u
const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'dan', 'di', 'untuk'])

function words(name: string): string[] {
  return normalizeText(name).split(WORD_SPLIT).filter(Boolean)
}

/** "Computer Science Society" -> "css" (students often type acronyms). */
function initials(name: string): string {
  return words(name)
    .filter((w) => !SMALL_WORDS.has(w))
    .map((w) => w[0] ?? '')
    .join('')
}

/** 0 = name starts with the query, 1 = a word starts with it, 2 = acronym,
 * 3 = contains it anywhere; null = no match. */
function rank(name: string, query: string): number | null {
  const n = normalizeText(name)
  if (n.startsWith(query)) return 0
  if (words(name).some((w) => w.startsWith(query))) return 1
  if (!query.includes(' ') && initials(name).startsWith(query)) return 2
  if (n.includes(query)) return 3
  return null
}

type Matchable = { name: string; type: OrgType }

/**
 * Organiser type-ahead: active orgs (optionally of one type) matching the text,
 * best matches first, then A–Z. `more` says the list was cut at `limit`.
 */
export function matchOrgs<T extends Matchable>(
  orgs: readonly T[],
  text: string,
  opts: { type?: OrgType; limit?: number } = {},
): { items: T[]; more: boolean } {
  const query = normalizeText(text)
  const limit = opts.limit ?? 50
  const scored: Array<{ org: T; score: number }> = []
  for (const org of orgs) {
    if (opts.type && org.type !== opts.type) continue
    const score = query ? rank(org.name, query) : 0
    if (score !== null) scored.push({ org, score })
  }
  scored.sort((a, b) => a.score - b.score || a.org.name.localeCompare(b.org.name, 'en', { sensitivity: 'base' }))
  return { items: scored.slice(0, limit).map((s) => s.org), more: scored.length > limit }
}
