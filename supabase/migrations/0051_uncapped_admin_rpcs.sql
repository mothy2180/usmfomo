-- 0051 — admin and maintenance RPCs that PostgREST's max_rows cannot cut.
--
-- PostgREST returns at most max_rows (100, config.toml) rows from any
-- set-returning RPC and still answers 200, so a longer result was silently
-- cut (accounts past the 100th, orphan files, purge counts). Now:
--   - every per-account decision uses a direct lookup (admin_get_account,
--     admin_get_account_by_username) that returns one jsonb value;
--   - admin_list_accounts returns one page (p_limit <= 100, p_offset) in a
--     total order, and its callers read pages until a short one;
--   - the purge, the orphan sweep and the file list of an org return one
--     jsonb array. max_rows never cuts a single (scalar) value.
-- Same rules as 0050: SECURITY DEFINER, empty search_path, service_role only.

-- ---------------------------------------------------------------------------
-- Account rows: one definition for the list and the lookups. With no
-- argument, every account; otherwise the one with that user id or username.
-- Only called by the admin_* functions below (EXECUTE for postgres only).
-- ---------------------------------------------------------------------------
create function private.account_rows(p_user uuid default null, p_username text default null)
returns table (
  user_id uuid, username text, is_owner boolean, account_active boolean,
  org_id uuid, org_name text, org_slug text, org_type public.org_type,
  org_campus public.campus, org_active boolean, created_at timestamptz,
  last_sign_in_at timestamptz, banned_until timestamptz,
  factor_count int, newest_factor_at timestamptz, live_posts int
)
language sql stable set search_path = ''
as $$
  select a.user_id, a.username, a.is_owner, a.active,
         o.id, o.name, o.slug, o.type, o.campus, o.active, a.created_at,
         u.last_sign_in_at, u.banned_until,
         (select count(*)::int from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified'),
         (select max(f.created_at) from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified'),
         (select count(*)::int from public.posts p where p.org_id = a.org_id and p.ends_at > now())
  from private.accounts a
  left join public.orgs o on o.id = a.org_id
  left join auth.users u on u.id = a.user_id
  where (p_user is null or a.user_id = p_user)
    and (p_username is null or a.username = p_username);
$$;
revoke all on function private.account_rows(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
drop function public.admin_list_accounts();

-- One page of accounts: the owner first, then by organisation name. user_id
-- makes the order total, so the same row always ends a page.
create function public.admin_list_accounts(p_limit int default 100, p_offset int default 0)
returns table (
  user_id uuid, username text, is_owner boolean, account_active boolean,
  org_id uuid, org_name text, org_slug text, org_type public.org_type,
  org_campus public.campus, org_active boolean, created_at timestamptz,
  last_sign_in_at timestamptz, banned_until timestamptz,
  factor_count int, newest_factor_at timestamptz, live_posts int
)
language sql stable security definer set search_path = ''
as $$
  select r.*
  from private.account_rows() r
  order by r.is_owner desc, r.org_name nulls first, r.user_id
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- One account as a jsonb object with the columns of admin_list_accounts, or
-- null when there is no account row (strict: a null argument is null too).
create function public.admin_get_account(p_user uuid)
returns jsonb
language sql stable strict security definer set search_path = ''
as $$
  select to_jsonb(r) from private.account_rows(p_user => p_user) r;
$$;

create function public.admin_get_account_by_username(p_username text)
returns jsonb
language sql stable strict security definer set search_path = ''
as $$
  select to_jsonb(r) from private.account_rows(p_username => lower(btrim(p_username))) r;
$$;

-- ---------------------------------------------------------------------------
-- Poster files of an org (names), for delete_account: all of them.
-- ---------------------------------------------------------------------------
drop function public.admin_org_objects(uuid);

create function public.admin_org_objects(p_org uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(o.name order by o.name), '[]'::jsonb)
  from storage.objects o
  where o.bucket_id = 'posters'
    and (storage.foldername(o.name))[1] = p_org::text;
$$;

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------
drop function public.maint_purge_expired(int);

-- Deletes up to p_limit (<= 100) expired posts and up to p_limit expired
-- notices. Rows are deleted first, and only while still expired (a post edited
-- back to live in between survives); the caller then removes the returned
-- files through the Storage API. Returns one array of
-- { kind: 'post'|'notice', id, poster_path, thumb_path }, posts first.
create function public.maint_purge_expired(p_limit int default 100)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_posts jsonb;
  v_notices jsonb;
begin
  with doomed as (
    select p.id from public.posts p
    where p.ends_at < now()
    order by p.ends_at
    limit v_limit
    for update skip locked
  ), del as (
    delete from public.posts p
    using doomed d
    where p.id = d.id and p.ends_at < now()
    returning p.id, p.poster_path, p.thumb_path
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'post', 'id', del.id, 'poster_path', del.poster_path, 'thumb_path', del.thumb_path)), '[]'::jsonb)
    into v_posts
  from del;

  with doomed as (
    select n.id from public.notices n
    where n.ends_at < now()
    order by n.ends_at
    limit v_limit
    for update skip locked
  ), del as (
    delete from public.notices n
    using doomed d
    where n.id = d.id and n.ends_at < now()
    returning n.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'notice', 'id', del.id, 'poster_path', null, 'thumb_path', null)), '[]'::jsonb)
    into v_notices
  from del;

  return v_posts || v_notices;
end
$$;

drop function public.maint_orphans(interval, int);

-- Names of poster files older than p_older_than that no post references
-- (failed edits, abandoned uploads, files left by a failed remove()), oldest
-- first: up to p_limit (default 500, at most 1000) as one jsonb array.
create function public.maint_orphans(p_older_than interval default interval '24 hours', p_limit int default 500)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(d.name order by d.created_at, d.name), '[]'::jsonb)
  from (
    select o.name, o.created_at
    from storage.objects o
    where o.bucket_id = 'posters'
      and o.created_at < now() - p_older_than
      and not exists (
        select 1 from public.posts p
        where p.poster_path = o.name or p.thumb_path = o.name
      )
    order by o.created_at, o.name
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  ) d;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE: service_role only (as in 0050).
-- ---------------------------------------------------------------------------
revoke all on function public.admin_list_accounts(int, int) from public, anon, authenticated;
revoke all on function public.admin_get_account(uuid) from public, anon, authenticated;
revoke all on function public.admin_get_account_by_username(text) from public, anon, authenticated;
revoke all on function public.admin_org_objects(uuid) from public, anon, authenticated;
revoke all on function public.maint_purge_expired(int) from public, anon, authenticated;
revoke all on function public.maint_orphans(interval, int) from public, anon, authenticated;
grant execute on function public.admin_list_accounts(int, int) to service_role;
grant execute on function public.admin_get_account(uuid) to service_role;
grant execute on function public.admin_get_account_by_username(text) to service_role;
grant execute on function public.admin_org_objects(uuid) to service_role;
grant execute on function public.maint_purge_expired(int) to service_role;
grant execute on function public.maint_orphans(interval, int) to service_role;
