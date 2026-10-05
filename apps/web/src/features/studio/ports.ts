// The real I/O behind submitPost.ts: Supabase Storage + PostgREST, as the
// signed-in club (RLS decides; see 0020_posts.sql and 0040_storage_posters.sql).
import type { Database } from '@usmfomo/shared'
import { BUCKET, POSTER } from '@usmfomo/shared/config'
import { studioDb } from '../../lib/db.ts'
import type { PostPorts } from './submitPost.ts'
import { POST_COLUMNS, type PostRow } from './types.ts'

type PostsInsert = Database['public']['Tables']['posts']['Insert']

/** Zero rows written means RLS filtered the row out (deleted, or this session
 * may no longer write): report it like the database's own refusal. */
const NO_ROWS = { code: '42501', message: 'no rows matched' }

export const studioPorts: PostPorts = {
  async upload(path, file, contentType) {
    const { error } = await studioDb.storage.from(BUCKET).upload(path, file, {
      upsert: false,
      cacheControl: String(POSTER.cacheControlSeconds),
      contentType,
    })
    if (error) throw error
  },
  async remove(paths) {
    const { error } = await studioDb.storage.from(BUCKET).remove(paths)
    if (error) throw error
  },
  async insert(row) {
    // The generated Insert type requires org_id, but the column has no INSERT
    // grant: posts_guard fills it from the session. Sending it would fail.
    const { data, error } = await studioDb
      .from('posts')
      .insert(row as PostsInsert)
      .select('id')
      .single()
    if (error) throw error
    return data
  },
  async update(id, patch) {
    const { data, error } = await studioDb.from('posts').update(patch).eq('id', id).select('id')
    if (error) throw error
    if (data.length === 0) throw NO_ROWS
  },
  async delete(id) {
    // Idempotent: zero rows means the post is already gone (purged after it
    // ended, or deleted by another committee member). The list is refetched
    // afterwards, so a post that somehow survived would show up again.
    const { error } = await studioDb.from('posts').delete().eq('id', id)
    if (error) throw error
  },
}

/** The club's own posts, including hidden and ended-but-not-yet-purged ones. */
export async function fetchOwnPosts(orgId: string): Promise<PostRow[]> {
  const { data, error } = await studioDb.from('posts').select(POST_COLUMNS).eq('org_id', orgId).order('starts_at')
  if (error) throw error
  return data
}

export async function fetchOwnPost(orgId: string, id: string): Promise<PostRow | null> {
  const { data, error } = await studioDb.from('posts').select(POST_COLUMNS).eq('org_id', orgId).eq('id', id).maybeSingle()
  if (error) throw error
  return data
}
