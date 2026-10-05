-- 0050 — RPCs for the two Edge Functions and the owner CLI.
--
-- Every function here is SECURITY DEFINER with EXECUTE granted to service_role
-- ONLY (the secret key). Edge Functions reach private/audit data through these
-- PostgREST RPCs, which also count as API activity for Supabase's free-plan
-- pause check. pgTAP asserts that anon and authenticated cannot execute them.
--
--   maint_*  : called by the maintenance function (hourly cron)
--   admin_*  : called by owner-admin (after it verified an aal2 owner) and by
--              scripts/account.ts

-- Owner-initiated changes made through admin_* RPCs must not count against a
-- club's limits or trip the kill switch; posts_guard honours this flag. It is a
-- transaction-local setting that API clients cannot set themselves.
create function private.bypass_limits() returns void
language sql volatile security definer set search_path = ''
as $$ select set_config('usmfomo.bypass_limits', 'on', true); $$;
revoke all on function private.bypass_limits() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- maintenance
-- ---------------------------------------------------------------------------
create function public.maint_heartbeat(p_result jsonb default null)
returns timestamptz
language sql volatile security definer set search_path = ''
as $$
  update private.heartbeat
     set last_run_at = now(), last_result = coalesce(p_result, last_result)
   where id = 1
  returning last_run_at;
$$;

-- Deletes up to p_limit expired posts and notices. Rows are deleted first, and
-- only while still expired (a post edited back to live in between survives);
-- the caller then removes the returned files through the Storage API.
create function public.maint_purge_expired(p_limit int default 100)
returns table (kind text, id uuid, poster_path text, thumb_path text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  return query
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
  select 'post'::text, del.id, del.poster_path, del.thumb_path from del;

  return query
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
  select 'notice'::text, del.id, null::text, null::text from del;
end
$$;

-- Poster files older than p_older_than that no post references (failed edits,
-- abandoned uploads, files left by a failed remove()).
create function public.maint_orphans(p_older_than interval default interval '24 hours', p_limit int default 500)
returns table (name text)
language sql stable security definer set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'posters'
    and o.created_at < now() - p_older_than
    and not exists (
      select 1 from public.posts p
      where p.poster_path = o.name or p.thumb_path = o.name
    )
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

create function public.maint_retention()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_log int;
  v_audit int;
begin
  delete from private.post_log where created_at < now() - interval '2 days';
  get diagnostics v_log = row_count;
  delete from audit.events where at < now() - interval '180 days';
  get diagnostics v_audit = row_count;
  return jsonb_build_object('post_log', v_log, 'audit', v_audit);
end
$$;

-- ---------------------------------------------------------------------------
-- owner administration
-- ---------------------------------------------------------------------------
create function public.admin_is_owner(p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.accounts a
    where a.user_id = p_uid and a.is_owner and a.active
  );
$$;

create function public.admin_create_org_account(
  p_user uuid, p_username text, p_org_name text, p_org_slug text,
  p_type public.org_type, p_campus public.campus
) returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  insert into public.orgs (slug, name, type, campus)
  values (lower(btrim(p_org_slug)), btrim(p_org_name), p_type, p_campus)
  returning id into v_org;

  insert into private.accounts (user_id, org_id, username, is_owner)
  values (p_user, v_org, lower(btrim(p_username)), false);

  perform private.audit('account_create', 'account', p_user, v_org,
    jsonb_build_object('username', lower(btrim(p_username)), 'org', btrim(p_org_name), 'type', p_type));
  return v_org;
end
$$;

create function public.admin_link_owner(p_user uuid, p_username text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  insert into private.accounts (user_id, org_id, username, is_owner)
  values (p_user, null, lower(btrim(p_username)), true);
  perform private.audit('owner_create', 'account', p_user, null,
    jsonb_build_object('username', lower(btrim(p_username))));
end
$$;

create function public.admin_set_account_active(p_user uuid, p_active boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update private.accounts set active = p_active where user_id = p_user;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0001';
  end if;
  perform private.audit(case when p_active then 'account_activate' else 'account_deactivate' end,
    'account', p_user, (select a.org_id from private.accounts a where a.user_id = p_user), null);
end
$$;

create function public.admin_update_org(
  p_org uuid, p_name text, p_slug text, p_type public.org_type,
  p_campus public.campus, p_active boolean
) returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.orgs
     set name = btrim(p_name), slug = lower(btrim(p_slug)), type = p_type,
         campus = p_campus, active = p_active
   where id = p_org;
  if not found then
    raise exception 'org_not_found' using errcode = 'P0001';
  end if;
  perform private.audit('org_update', 'org', p_org, p_org,
    jsonb_build_object('name', p_name, 'slug', p_slug, 'type', p_type, 'campus', p_campus, 'active', p_active));
end
$$;

create function public.admin_list_accounts()
returns table (
  user_id uuid, username text, is_owner boolean, account_active boolean,
  org_id uuid, org_name text, org_slug text, org_type public.org_type,
  org_campus public.campus, org_active boolean, created_at timestamptz,
  last_sign_in_at timestamptz, banned_until timestamptz,
  factor_count int, newest_factor_at timestamptz, live_posts int
)
language sql stable security definer set search_path = ''
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
  order by a.is_owner desc, o.name nulls first;
$$;

create function public.admin_org_objects(p_org uuid)
returns table (name text)
language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'posters'
    and (storage.foldername(o.name))[1] = p_org::text;
$$;

-- Deletes the org, its posts and its account row (FK cascades). Call after
-- removing the org's storage objects; delete the auth user afterwards.
create function public.admin_delete_org(p_org uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.bypass_limits();
  perform private.audit('org_delete', 'org', p_org, p_org,
    (select jsonb_build_object('name', o.name, 'slug', o.slug) from public.orgs o where o.id = p_org));
  delete from public.orgs where id = p_org;
  if not found then
    raise exception 'org_not_found' using errcode = 'P0001';
  end if;
end
$$;

create function public.admin_delete_post(p_post uuid)
returns table (poster_path text, thumb_path text)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.bypass_limits();
  return query
  delete from public.posts p where p.id = p_post
  returning p.poster_path, p.thumb_path;
end
$$;

create function public.admin_remove_post_image(p_post uuid)
returns table (poster_path text, thumb_path text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_poster text;
  v_thumb text;
begin
  perform private.bypass_limits();
  select p.poster_path, p.thumb_path into v_poster, v_thumb
  from public.posts p where p.id = p_post for update;
  if not found then
    return;
  end if;
  update public.posts set poster_path = null, thumb_path = null where id = p_post;
  return query select v_poster, v_thumb;
end
$$;

create function public.admin_status()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'last_maintenance_at', (select h.last_run_at from private.heartbeat h where h.id = 1),
    'last_maintenance_result', (select h.last_result from private.heartbeat h where h.id = 1),
    'live_posts', (select count(*) from public.posts p where p.ends_at > now()),
    'live_notices', (select count(*) from public.notices n where n.ends_at > now()),
    'storage_objects', (select count(*) from storage.objects o where o.bucket_id = 'posters'),
    'storage_bytes', (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o where o.bucket_id = 'posters'),
    'settings', (select to_jsonb(s) - 'id' from public.site_settings s where s.id = 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE: service_role only.
-- ---------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'maint\_%' or p.proname like 'admin\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;
