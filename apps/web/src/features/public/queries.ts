// Data for the public pages. Always the anonymous client (publicDb), so every
// page shows exactly what any student sees; RLS decides what that is.
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { OrgType } from '@usmfomo/shared/config'
import { publicDb } from '../../lib/db.ts'
import { isOrgSlug, isUuid } from './ids.ts'
import { nextOffset, PAGE_SIZE } from './paging.ts'
import type { EventDetail, Notice, OrgSummary, PostCard, PostFilters, PostPage } from './types.ts'

/** PostgREST max_rows (supabase/config.toml): longer lists are read in pages. */
const MAX_ROWS = 100
const ORG_PAGES_CAP = 20

export async function fetchPostPage(type: OrgType, filters: PostFilters, offset: number, signal?: AbortSignal): Promise<PostPage> {
  let call = publicDb.rpc('search_posts', {
    p_type: type,
    ...(filters.q ? { p_q: filters.q } : {}),
    ...(filters.campus ? { p_campus: filters.campus } : {}),
    ...(filters.org ? { p_org: filters.org } : {}),
    p_limit: PAGE_SIZE,
    p_offset: offset,
  })
  if (signal) call = call.abortSignal(signal)
  const { data, error } = await call
  if (error) throw error
  const rows: PostCard[] = data ?? []
  return { rows, total: rows[0]?.total ?? 0, offset }
}

/** One dashboard/organiser list: 20 cards per page, "Show more" loads the next. */
export function usePostSearch(type: OrgType, filters: PostFilters, opts: { enabled?: boolean; keepPrevious?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ['public', 'search_posts', type, filters.q ?? null, filters.campus ?? null, filters.org ?? null],
    queryFn: ({ pageParam, signal }) => fetchPostPage(type, filters, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => nextOffset(last),
    enabled: opts.enabled ?? true,
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
  })
}

export function useNotices() {
  return useQuery({
    queryKey: ['public', 'notices'],
    queryFn: async ({ signal }): Promise<Notice[]> => {
      const { data, error } = await publicDb
        .from('notices')
        .select('id,title,body,link_url,starts_at,ends_at,updated_at')
        .order('starts_at', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(20)
        .abortSignal(signal)
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

/** Every active organiser (RLS hides inactive ones), for the type-ahead.
 * Pass enabled=false until it's needed: it's the biggest list on the page. */
export function useOrgs(enabled = true) {
  return useQuery({
    queryKey: ['public', 'orgs'],
    enabled,
    queryFn: async ({ signal }): Promise<OrgSummary[]> => {
      const out: OrgSummary[] = []
      for (let page = 0; page < ORG_PAGES_CAP; page++) {
        const from = page * MAX_ROWS
        const { data, error } = await publicDb
          .from('orgs')
          .select('id,name,slug,type,campus')
          .order('name')
          .order('id')
          .range(from, from + MAX_ROWS - 1)
          .abortSignal(signal)
        if (error) throw error
        out.push(...(data ?? []))
        if (!data || data.length < MAX_ROWS) break
      }
      return out
    },
    staleTime: 10 * 60_000,
  })
}

const EVENT_COLUMNS =
  'id,org_id,campus,title,venue,description,link_url,starts_at,ends_at,poster_path,thumb_path,cancelled_at,details_changed_at,updated_at,org:orgs(id,name,slug,type)'

/** The event page. null = no such visible post (ended, deleted or hidden —
 * the page deliberately can't tell which). Invalid ids never hit the API. */
export function useEventPost(id: string) {
  const key = id.toLowerCase()
  return useQuery({
    queryKey: ['public', 'post', key],
    enabled: isUuid(id),
    queryFn: async ({ signal }): Promise<EventDetail | null> => {
      const { data, error } = await publicDb.from('posts').select(EVENT_COLUMNS).eq('id', key).abortSignal(signal).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useOrgBySlug(slug: string) {
  return useQuery({
    queryKey: ['public', 'org', slug],
    enabled: isOrgSlug(slug),
    queryFn: async ({ signal }): Promise<OrgSummary | null> => {
      const { data, error } = await publicDb
        .from('orgs')
        .select('id,name,slug,type,campus')
        .eq('slug', slug)
        .abortSignal(signal)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** Only asked when a page came back empty: false means the owner switched
 * public reads off (quota-attack runbook), so "no events" would be untrue. */
export function usePublicReadsEnabled(enabled: boolean) {
  return useQuery({
    queryKey: ['public', 'site_settings'],
    enabled,
    queryFn: async ({ signal }): Promise<boolean> => {
      const { data, error } = await publicDb.from('site_settings').select('public_reads_enabled').limit(1).abortSignal(signal).maybeSingle()
      if (error) throw error
      return data?.public_reads_enabled ?? true
    },
    staleTime: 5 * 60_000,
  })
}
