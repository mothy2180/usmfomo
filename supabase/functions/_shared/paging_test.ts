import { assertEquals, assertRejects } from '@std/assert'
import { MAX_PAGES, PAGE_SIZE, readAllPages } from './paging.ts'

/** A server like PostgREST: the requested page, but never more than max_rows rows. */
function server(total: number, maxRows = PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `r${String(i).padStart(4, '0')}` }))
  const asked: Array<[number, number]> = []
  const read = (offset: number, limit: number) => {
    asked.push([offset, limit])
    return Promise.resolve(rows.slice(offset, offset + Math.min(limit, maxRows)))
  }
  return { rows, asked, read }
}

Deno.test('readAllPages: reads past the 100-row cap until a short page', async () => {
  const s = server(250)
  assertEquals(await readAllPages(s.read, (r) => r.id), s.rows)
  assertEquals(s.asked, [[0, 100], [100, 100], [200, 100]])
})

Deno.test('readAllPages: an exact multiple of the page size ends on an empty page', async () => {
  const s = server(200)
  assertEquals((await readAllPages(s.read, (r) => r.id)).length, 200)
  assertEquals(s.asked.map(([offset]) => offset), [0, 100, 200])

  const empty = server(0)
  assertEquals(await readAllPages(empty.read, (r) => r.id), [])
  assertEquals(empty.asked, [[0, 100]])
})

Deno.test('readAllPages: a row pushed onto the next page by an insert is kept once', async () => {
  const first = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `a${i}` }))
  // Between the two reads one row sorted in before the page boundary, so the
  // last row of page 1 comes back first on page 2.
  const second = [first[PAGE_SIZE - 1], { id: 'b0' }]
  const pages = [first, second]
  const rows = await readAllPages((offset) => Promise.resolve(pages[offset / PAGE_SIZE] ?? []), (r) => r.id)
  assertEquals(rows.length, PAGE_SIZE + 1)
  assertEquals(rows.at(-1), { id: 'b0' })
})

Deno.test('readAllPages: throws instead of returning a cut list', async () => {
  const always = () => Promise.resolve(Array.from({ length: PAGE_SIZE }, () => ({ id: crypto.randomUUID() })))
  let pages = 0
  await assertRejects(
    () =>
      readAllPages(() => {
        pages++
        return always()
      }, (r) => r.id),
    Error,
    'not read to the end',
  )
  assertEquals(pages, MAX_PAGES)
})
