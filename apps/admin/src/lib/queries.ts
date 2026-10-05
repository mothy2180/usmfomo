// Data the console reads. owner-admin for status and accounts; PostgREST (RLS:
// the owner may read every row) for settings, posts and notices, so the kill
// switches and moderation still work when the Edge Function is down.
import type { QueryData } from '@supabase/supabase-js'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { adminApi, ownerDb } from './db.ts'
import { NoRowsError } from './messages.ts'
import { verifiedTotpFactors } from './mfa.ts'

export const qk = {
  status: ['status'],
  accounts: ['accounts'],
  settings: ['settings'],
  posts: ['posts'],
  notices: ['notices'],
  factors: ['factors'],
} as const

export function useStatus() {
  return useQuery({ queryKey: qk.status, queryFn: () => adminApi.status(), refetchInterval: 5 * 60_000 })
}

export function useAccounts() {
  return useQuery({ queryKey: qk.accounts, queryFn: () => adminApi.listAccounts() })
}

export function useFactors() {
  return useQuery({ queryKey: qk.factors, queryFn: verifiedTotpFactors })
}

// ---------------------------------------------------------------------------
// Kill switches (public.site_settings, single row id = 1).
// ---------------------------------------------------------------------------

const SETTINGS_COLUMNS = 'posting_enabled,public_reads_enabled,updated_at'
export type SiteSettings = { posting_enabled: boolean; public_reads_enabled: boolean; updated_at: string }
export type SwitchName = 'posting_enabled' | 'public_reads_enabled'

async function fetchSettings(): Promise<SiteSettings> {
  const { data, error } = await ownerDb.from('site_settings').select(SETTINGS_COLUMNS).eq('id', 1).single()
  if (error) throw error
  return data
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: fetchSettings })
}

/** Updates one switch; the returned row proves RLS let the owner write it. */
export async function setSwitch(name: SwitchName, value: boolean): Promise<SiteSettings> {
  const patch = name === 'posting_enabled' ? { posting_enabled: value } : { public_reads_enabled: value }
  const { data, error } = await ownerDb.from('site_settings').update(patch).eq('id', 1).select(SETTINGS_COLUMNS)
  if (error) throw error
  const row = data[0]
  if (!row) throw new NoRowsError()
  return row
}

// ---------------------------------------------------------------------------
// Posts (moderation). max_rows = 100 per request, so pages are fetched until
// a short page; capped so a runaway table can't freeze the browser.
// ---------------------------------------------------------------------------

const POST_COLUMNS =
  'id,org_id,campus,title,venue,description,link_url,starts_at,ends_at,poster_path,thumb_path,cancelled_at,hidden_at,created_at,updated_at,org:orgs(id,name,slug,type,active)'
const PAGE_SIZE = 100
const MAX_PAGES = 30

const postsPage = (from: number) =>
  ownerDb
    .from('posts')
    .select(POST_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

export type ModPost = QueryData<ReturnType<typeof postsPage>>[number]
export type PostsResult = { rows: ModPost[]; truncated: boolean }

async function fetchAllPosts(): Promise<PostsResult> {
  const byId = new Map<string, ModPost>()
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await postsPage(page * PAGE_SIZE)
    if (error) throw error
    for (const row of data) byId.set(row.id, row)
    if (data.length < PAGE_SIZE) return { rows: [...byId.values()], truncated: false }
  }
  return { rows: [...byId.values()], truncated: true }
}

export function usePosts() {
  return useQuery({ queryKey: qk.posts, queryFn: fetchAllPosts })
}

/** After a moderation action: change one cached post instead of refetching every page. */
export function patchCachedPost(queryClient: QueryClient, postId: string, patch: Partial<ModPost>): void {
  queryClient.setQueryData<PostsResult>(qk.posts, (old) =>
    old ? { ...old, rows: old.rows.map((p) => (p.id === postId ? { ...p, ...patch } : p)) } : old,
  )
}

export function dropCachedPost(queryClient: QueryClient, postId: string): void {
  queryClient.setQueryData<PostsResult>(qk.posts, (old) => (old ? { ...old, rows: old.rows.filter((p) => p.id !== postId) } : old))
}

/** Hide (hidden_at = now) or unhide (null). Only the owner may change hidden_at. */
export async function setPostHidden(postId: string, hidden: boolean): Promise<{ id: string; hidden_at: string | null; updated_at: string }> {
  const { data, error } = await ownerDb
    .from('posts')
    .update({ hidden_at: hidden ? new Date().toISOString() : null })
    .eq('id', postId)
    .select('id,hidden_at,updated_at')
  if (error) throw error
  const row = data[0]
  if (!row) throw new NoRowsError()
  return row
}

// ---------------------------------------------------------------------------
// Notices (owner CRUD through RLS).
// ---------------------------------------------------------------------------

const NOTICE_COLUMNS = 'id,title,body,link_url,starts_at,ends_at,created_at,updated_at'

const noticesQuery = () => ownerDb.from('notices').select(NOTICE_COLUMNS).order('starts_at', { ascending: false }).limit(100)

export type NoticeRow = QueryData<ReturnType<typeof noticesQuery>>[number]
export type NoticeInput = { title: string; body: string; link_url: string | null; starts_at: string; ends_at: string }

async function fetchNotices(): Promise<NoticeRow[]> {
  const { data, error } = await noticesQuery()
  if (error) throw error
  return data
}

export function useNotices() {
  return useQuery({ queryKey: qk.notices, queryFn: fetchNotices })
}

export async function createNotice(input: NoticeInput): Promise<NoticeRow> {
  const { data, error } = await ownerDb.from('notices').insert(input).select(NOTICE_COLUMNS)
  if (error) throw error
  const row = data[0]
  if (!row) throw new NoRowsError()
  return row
}

export async function updateNotice(id: string, input: NoticeInput): Promise<NoticeRow> {
  const { data, error } = await ownerDb.from('notices').update(input).eq('id', id).select(NOTICE_COLUMNS)
  if (error) throw error
  const row = data[0]
  if (!row) throw new NoRowsError()
  return row
}

export async function deleteNotice(id: string): Promise<void> {
  const { data, error } = await ownerDb.from('notices').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data.length) throw new NoRowsError()
}
