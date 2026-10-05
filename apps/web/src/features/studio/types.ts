import type { Database } from '@usmfomo/shared'

export type PostRow = Database['public']['Tables']['posts']['Row']

/** Columns the studio reads (own posts, including hidden and expired ones). */
export const POST_COLUMNS =
  'id,org_id,campus,title,venue,description,link_url,starts_at,ends_at,poster_path,thumb_path,cancelled_at,hidden_at,details_changed_at,created_at,updated_at' as const

/**
 * What a club may write (the column grants in 0020_posts.sql). There is no
 * org_id: it has no INSERT grant and the posts_guard trigger sets it from the
 * session, so sending it fails with "permission denied".
 */
export type PostInsertRow = {
  campus: PostRow['campus']
  title: string
  venue: string
  description: string | null
  link_url: string | null
  starts_at: string
  ends_at: string
  poster_path: string | null
  thumb_path: string | null
}

export type PostPatch = Partial<PostInsertRow & { cancelled_at: string | null }>
