import type { Campus, OrgType } from '@usmfomo/shared/config'

/** One card from rpc('search_posts'). The generated types mark the nullable
 * columns of a function result as non-null; these are the real shapes. */
export type PostCard = {
  id: string
  org_id: string
  org_name: string
  org_slug: string
  org_type: OrgType
  campus: Campus
  title: string
  venue: string
  starts_at: string
  ends_at: string
  thumb_path: string | null
  cancelled_at: string | null
  details_changed_at: string | null
  /** Full match count, repeated on every row of every page. */
  total: number
}

/** One page of search_posts; `offset` is the server position of rows[0]. */
export type PostPage = { rows: PostCard[]; total: number; offset: number }

/** Filters the database applies (search_posts p_q, p_campus, p_org). */
export type PostFilters = { q?: string; campus?: Campus; org?: string }

export type Notice = {
  id: string
  title: string
  body: string
  link_url: string | null
  starts_at: string
  ends_at: string
  updated_at: string
}

export type OrgSummary = { id: string; name: string; slug: string; type: OrgType; campus: Campus }

export type EventOrg = { id: string; name: string; slug: string; type: OrgType }

/** The event page row (posts + embedded org). */
export type EventDetail = {
  id: string
  org_id: string
  campus: Campus
  title: string
  venue: string
  description: string | null
  link_url: string | null
  starts_at: string
  ends_at: string
  poster_path: string | null
  thumb_path: string | null
  cancelled_at: string | null
  details_changed_at: string | null
  updated_at: string
  org: EventOrg | null
}
