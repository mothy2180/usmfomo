import { assertEquals } from '@std/assert'
import { httpErrorFromRpc, RpcError } from './db.ts'
import { REMOVE_BATCH_SIZE, removeInBatches } from './storage.ts'

Deno.test('removeInBatches: de-duplicates, skips empty values, batches at 1000', async () => {
  const batches: string[][] = []
  const names = Array.from({ length: 2500 }, (_, i) => `org/${i}.webp`)
  const result = await removeInBatches((batch) => {
    batches.push(batch)
    return Promise.resolve(batch.length)
  }, [...names, names[0], null, undefined, ''])
  assertEquals(batches.map((b) => b.length), [REMOVE_BATCH_SIZE, REMOVE_BATCH_SIZE, 500])
  assertEquals(result, { removed: 2500, failed: 0 })
})

Deno.test('removeInBatches: nothing to remove makes no call', async () => {
  let calls = 0
  const result = await removeInBatches(() => {
    calls++
    return Promise.resolve(0)
  }, [null, null])
  assertEquals(calls, 0)
  assertEquals(result, { removed: 0, failed: 0 })
})

Deno.test('removeInBatches: a failed batch is counted and the rest continue', async () => {
  const names = Array.from({ length: 1500 }, (_, i) => `org/${i}.webp`)
  let call = 0
  const result = await removeInBatches((batch) => {
    call++
    if (call === 1) return Promise.reject(new Error('storage down'))
    return Promise.resolve(batch.length - 1) // one file was already gone
  }, names)
  assertEquals(result, { removed: 499, failed: 1000 })
})

Deno.test('httpErrorFromRpc: maps database errors to API codes', () => {
  const code = (c: string, m = 'x') => httpErrorFromRpc(new RpcError('admin_x', c, m)).code
  assertEquals(code('P0001', 'account_not_found'), 'not_found')
  assertEquals(code('P0001', 'org_not_found'), 'not_found')
  assertEquals(code('P0001', 'posting_paused'), 'internal')
  assertEquals(code('23505'), 'conflict')
  assertEquals(code('23514'), 'bad_request')
  assertEquals(code('22P02'), 'bad_request')
  assertEquals(code('42501'), 'internal')
  assertEquals(code('PGRST202'), 'internal')
  assertEquals(code(''), 'internal')
})
