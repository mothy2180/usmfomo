// Reading a paged admin_* RPC to the end. PostgREST returns at most max_rows
// (100, supabase/config.toml) rows from a set-returning RPC and still answers
// 200, so a list that can grow past that is read one page at a time.
//
// Plain TypeScript with no runtime-specific imports: the owner CLI
// (scripts/account.ts, Node) uses it too.

/** Rows per page: PostgREST's max_rows and the cap inside the paged RPCs (0051). Never above max_rows. */
export const PAGE_SIZE = 100
/** Safety stop: 100 pages are 10,000 rows, far more than any list here. */
export const MAX_PAGES = 100

/** One page: at most `limit` rows from `offset` on, in a total order. */
export type PageReader<T> = (offset: number, limit: number) => Promise<T[]>

/**
 * Every row, in order: reads pages until one comes back short. A row that a
 * concurrent insert pushed onto the next page is kept once (by `key`). Throws
 * rather than return a cut list when MAX_PAGES pages are all full.
 */
export async function readAllPages<T>(readPage: PageReader<T>, key: (row: T) => string): Promise<T[]> {
  const rows: T[] = []
  const seen = new Set<string>()
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await readPage(page * PAGE_SIZE, PAGE_SIZE)
    for (const row of batch) {
      const k = key(row)
      if (seen.has(k)) continue
      seen.add(k)
      rows.push(row)
    }
    if (batch.length < PAGE_SIZE) return rows
  }
  throw new Error(`more than ${MAX_PAGES * PAGE_SIZE} rows: the list was not read to the end`)
}
