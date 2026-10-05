import type { PostCard, PostPage } from './types.ts'

/** Cards per search_posts call (the RPC caps p_limit at 50). */
export const PAGE_SIZE = 20

/** TanStack getNextPageParam: the next server offset, or undefined at the end. */
export function nextOffset(last: PostPage): number | undefined {
  const loaded = last.offset + last.rows.length
  return last.rows.length > 0 && loaded < last.total ? loaded : undefined
}

/** All loaded cards in order. Offsets can shift between page loads (a post is
 * added or ends), so a card may appear on two pages; keep the first copy. */
export function flattenPages(pages: readonly PostPage[]): PostCard[] {
  const seen = new Set<string>()
  const out: PostCard[] = []
  for (const page of pages) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
    }
  }
  return out
}

/** The newest full count: from the last page that returned rows, else 0. */
export function totalOf(pages: readonly PostPage[]): number {
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i]
    if (page && page.rows.length > 0) return page.total
  }
  return 0
}

/** Count for headings and tab labels; undefined until the first page arrives. */
export function countOf(data: { pages: readonly PostPage[] } | undefined): number | undefined {
  return data ? totalOf(data.pages) : undefined
}
