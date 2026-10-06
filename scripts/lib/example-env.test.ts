// supabase/.env.example publishes a CRON_SECRET for the local stack. The
// maintenance function refuses exactly that value anywhere else, so the two
// must stay equal. (The Deno tests run without read access, hence a Node test.)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parseStatusEnv } from './target.ts'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('supabase/.env.example', () => {
  it('has the CRON_SECRET that maintenance refuses outside the local stack', () => {
    const published = parseStatusEnv(read('supabase/.env.example')).CRON_SECRET
    const refused = /LOCAL_EXAMPLE_CRON_SECRET = '([^']+)'/.exec(read('supabase/functions/maintenance/handler.ts'))?.[1]
    assert.ok(published, 'supabase/.env.example has a CRON_SECRET')
    assert.equal(refused, published)
  })
})
