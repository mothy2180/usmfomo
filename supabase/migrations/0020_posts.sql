-- 0020 — event posts: table, CHECKs, grants, RLS, limits (BEFORE trigger),
-- audit (AFTER trigger), and the read RPCs the dashboard and studio use.
--
-- Times are timestamptz; the UI enters and shows Malaysia time (UTC+8).
-- Trigger errors use SQLSTATE P0001 with a stable message the UI translates:
--   posting_paused, quota_live, quota_daily, quota_edits, end_in_past,
--   start_too_early, start_too_late, too_long, path_invalid, owner_only

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  campus public.campus not null default 'main',
  title text not null,
  venue text not null,
  description text,
  link_url text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  poster_path text,
  thumb_path text,
  cancelled_at timestamptz,
  hidden_at timestamptz,
  details_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint posts_title_len check (char_length(title) between 3 and 100),
  constraint posts_title_chars check (title !~ '[[:cntrl:]]'),
  constraint posts_venue_len check (char_length(venue) between 2 and 120),
  constraint posts_venue_chars check (venue !~ '[[:cntrl:]]'),
  constraint posts_description_len check (description is null or char_length(description) <= 1000),
  -- newline (\x0a) is allowed in descriptions; every other control character is not
  constraint posts_description_chars check (description is null or description !~ '[\x01-\x09\x0b-\x1f\x7f]'),
  -- https only, no userinfo ("user@host"), ASCII host (IDNs must be punycode)
  constraint posts_link_url check (
    link_url is null or (
      char_length(link_url) <= 300
      and link_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$'
    )
  ),
  constraint posts_time_order check (ends_at > starts_at),
  constraint posts_max_length check (ends_at <= starts_at + interval '31 days'),
  constraint posts_poster_pair check ((poster_path is null) = (thumb_path is null))
);

create index posts_org_id on public.posts (org_id);
create index posts_ends_at on public.posts (ends_at);
create index posts_starts_at on public.posts (starts_at);

-- Daily new-post limit is counted here, not from posts, so delete-and-repost
-- cannot reset it. Rows older than 2 days are removed by maintenance.
create table private.post_log (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  post_id uuid not null,
  created_at timestamptz not null default now()
);
create index post_log_org_created on private.post_log (org_id, created_at);
alter table private.post_log enable row level security;

-- ---------------------------------------------------------------------------
-- Grants (column-scoped for writes) and RLS.
-- ---------------------------------------------------------------------------
alter table public.posts enable row level security;

grant select on public.posts to anon, authenticated;
grant insert (campus, title, venue, description, link_url, starts_at, ends_at,
              poster_path, thumb_path, cancelled_at)
  on public.posts to authenticated;
grant update (campus, title, venue, description, link_url, starts_at, ends_at,
              poster_path, thumb_path, cancelled_at, hidden_at)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;

create policy posts_public_read on public.posts
  for select to anon, authenticated
  using (
    ends_at > now()
    and hidden_at is null
    and (select s.public_reads_enabled from public.site_settings s where s.id = 1)
    and exists (select 1 from public.orgs o where o.id = posts.org_id and o.active)
  );

-- A club sees all of its own posts (hidden or expired-but-not-purged) in Studio.
create policy posts_own_read on public.posts
  for select to authenticated
  using (org_id = (select private.my_org_id()));

create policy posts_owner_read on public.posts
  for select to authenticated
  using ((select private.is_owner()));

create policy posts_own_insert on public.posts
  for insert to authenticated
  with check (org_id = (select private.my_org_id()));

create policy posts_own_update on public.posts
  for update to authenticated
  using (org_id = (select private.my_org_id()))
  with check (org_id = (select private.my_org_id()));

-- The owner may hide/unhide (and correct) any post. Owner deletes go through
-- the owner-admin Edge Function so poster files are removed at the same time.
create policy posts_owner_update on public.posts
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

create policy posts_own_delete on public.posts
  for delete to authenticated
  using (org_id = (select private.my_org_id()));

-- ---------------------------------------------------------------------------
-- BEFORE trigger: identity fields, kill switch, date windows, quotas, paths.
-- Runs before RLS WITH CHECK, so RLS judges what this trigger writes.
-- ---------------------------------------------------------------------------
create function private.posts_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  -- Set (transaction-local) only by service-only admin_* RPCs and local seeds;
  -- clients cannot set custom settings through the Data API.
  v_bypass boolean := coalesce(current_setting('usmfomo.bypass_limits', true), '') = 'on';
  -- Owner (aal2, live session) or bypass: exempt from the kill switch and quotas.
  v_owner boolean := v_bypass or coalesce(private.is_owner(), false);
  v_dates_changed boolean;
  v_count int;
begin
  if tg_op = 'INSERT' then
    new.id := coalesce(new.id, gen_random_uuid());
    if not v_bypass then
      new.org_id := private.my_org_id();
    end if;
    if new.org_id is null then
      return new;  -- not an active, MFA-satisfied org session: RLS rejects it (42501)
    end if;
    new.created_at := now();
    new.hidden_at := null;
    new.details_changed_at := null;
  else
    new.id := old.id;
    new.org_id := old.org_id;
    new.created_at := old.created_at;
    if new.hidden_at is distinct from old.hidden_at and not v_owner then
      raise exception 'owner_only' using errcode = 'P0001';
    end if;
    if (new.starts_at, new.ends_at, new.venue) is distinct from (old.starts_at, old.ends_at, old.venue) then
      new.details_changed_at := now();
    end if;
  end if;
  new.updated_at := now();

  -- One writer per org at a time, so the counts below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('posts:' || new.org_id::text, 0));

  if not v_owner and not coalesce((select s.posting_enabled from public.site_settings s where s.id = 1), false) then
    raise exception 'posting_paused' using errcode = 'P0001';
  end if;

  v_dates_changed := tg_op = 'INSERT'
    or (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at);

  if v_dates_changed then
    if tg_op = 'INSERT' then
      -- An event already in progress may still be posted, but it must have
      -- at least 15 minutes left.
      if new.ends_at < now() + interval '15 minutes' then
        raise exception 'end_in_past' using errcode = 'P0001';
      end if;
    else
      if new.starts_at is distinct from old.starts_at and new.starts_at < now() - interval '1 hour' then
        raise exception 'start_too_early' using errcode = 'P0001';
      end if;
      if new.ends_at <= now() then
        raise exception 'end_in_past' using errcode = 'P0001';
      end if;
    end if;
    if new.starts_at > now() + interval '365 days' then
      raise exception 'start_too_late' using errcode = 'P0001';
    end if;

    -- Live-post cap, rechecked when an edit moves dates (stops reviving or
    -- stockpiling posts). The owner is exempt.
    if not v_owner then
      select count(*) into v_count
      from public.posts p
      where p.org_id = new.org_id
        and p.ends_at > now()
        and (tg_op = 'INSERT' or p.id <> new.id);
      if v_count >= 15 then
        raise exception 'quota_live' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- No permanent adverts: a post can never outlive its creation by 400 days.
  if new.ends_at > new.created_at + interval '400 days' then
    raise exception 'too_long' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' and not v_owner then
    select count(*) into v_count
    from private.post_log l
    where l.org_id = new.org_id and l.created_at > now() - interval '24 hours';
    if v_count >= 5 then
      raise exception 'quota_daily' using errcode = 'P0001';
    end if;
  elsif tg_op = 'UPDATE' and not v_owner then
    select count(*) into v_count
    from audit.events e
    where e.org_id = new.org_id and e.action = 'post_update' and e.at > now() - interval '24 hours';
    if v_count >= 30 then
      raise exception 'quota_edits' using errcode = 'P0001';
    end if;
  end if;

  -- Exact storage paths inside the org's own folder (no "../" tricks).
  if new.poster_path is not null
     and new.poster_path !~ ('^' || new.org_id::text || '/[0-9a-f-]{36}\.(webp|jpg)$') then
    raise exception 'path_invalid' using errcode = 'P0001';
  end if;
  if new.thumb_path is not null
     and new.thumb_path !~ ('^' || new.org_id::text || '/[0-9a-f-]{36}-thumb\.(webp|jpg)$') then
    raise exception 'path_invalid' using errcode = 'P0001';
  end if;

  return new;
end
$$;
revoke all on function private.posts_guard() from public, anon, authenticated;

create trigger posts_guard before insert or update on public.posts
  for each row execute function private.posts_guard();

-- ---------------------------------------------------------------------------
-- AFTER trigger: daily-limit log + audit (changed columns only).
-- ---------------------------------------------------------------------------
create function private.posts_after()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    insert into private.post_log (org_id, post_id) values (new.org_id, new.id);
    perform private.audit('post_insert', 'post', new.id, new.org_id,
      jsonb_build_object('title', new.title, 'starts_at', new.starts_at, 'ends_at', new.ends_at));
    return new;
  elsif tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value))
      into v_changes
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'details_changed_at');
    perform private.audit(
      case when new.hidden_at is distinct from old.hidden_at
             or coalesce(current_setting('usmfomo.bypass_limits', true), '') = 'on'
           then 'post_moderate' else 'post_update' end,
      'post', new.id, new.org_id, v_changes);
    return new;
  else
    perform private.audit(
      case when old.ends_at < now() then 'post_expire' else 'post_delete' end,
      'post', old.id, old.org_id, jsonb_build_object('title', old.title));
    return old;
  end if;
end
$$;
revoke all on function private.posts_after() from public, anon, authenticated;

create trigger posts_after after insert or update or delete on public.posts
  for each row execute function private.posts_after();

-- ---------------------------------------------------------------------------
-- Dashboard search (SECURITY INVOKER: RLS still applies). Filters repeat the
-- public-read rule so a signed-in club never sees its own hidden/expired posts
-- in the public panels.
-- ---------------------------------------------------------------------------
create function public.search_posts(
  p_type public.org_type,
  p_q text default null,
  p_campus public.campus default null,
  p_org uuid default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  org_id uuid,
  org_name text,
  org_slug text,
  org_type public.org_type,
  campus public.campus,
  title text,
  venue text,
  starts_at timestamptz,
  ends_at timestamptz,
  thumb_path text,
  cancelled_at timestamptz,
  details_changed_at timestamptz,
  total bigint
)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    select nullif(btrim(left(coalesce(p_q, ''), 100)), '') as text
  ), pattern as (
    select '%' || replace(replace(replace(q.text, '\', '\\'), '%', '\%'), '_', '\_') || '%' as like
    from q where q.text is not null
  )
  select p.id, p.org_id, o.name, o.slug, o.type, p.campus, p.title, p.venue,
         p.starts_at, p.ends_at, p.thumb_path, p.cancelled_at, p.details_changed_at,
         count(*) over () as total
  from public.posts p
  join public.orgs o on o.id = p.org_id
  where o.type = p_type
    and o.active
    and p.ends_at > now()
    and p.hidden_at is null
    and (select s.public_reads_enabled from public.site_settings s where s.id = 1)
    and (p_campus is null or p.campus = p_campus)
    and (p_org is null or p.org_id = p_org)
    and (
      not exists (select 1 from pattern)
      or p.title ilike (select pattern.like from pattern)
      or p.venue ilike (select pattern.like from pattern)
      or o.name ilike (select pattern.like from pattern)
    )
  order by (p.starts_at <= now()) desc,
           case when p.starts_at <= now() then p.ends_at end asc,
           p.starts_at asc,
           p.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.search_posts(public.org_type, text, public.campus, uuid, int, int) from public;
grant execute on function public.search_posts(public.org_type, text, public.campus, uuid, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Studio status bar. SECURITY DEFINER because it reads private tables; it only
-- ever describes the caller's own account (accepted Advisor lint 0029).
-- ---------------------------------------------------------------------------
create function public.my_posting_status()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_acc record;
  v_new24 int;
begin
  if v_uid is null then
    return jsonb_build_object('state', 'anonymous');
  end if;

  select a.org_id, a.username, a.is_owner, a.active, o.name, o.slug, o.type, o.campus, o.active as org_active
    into v_acc
  from private.accounts a
  left join public.orgs o on o.id = a.org_id
  where a.user_id = v_uid;

  if not found then
    return jsonb_build_object('state', 'no_account');
  elsif v_acc.is_owner then
    return jsonb_build_object('state', 'owner', 'username', v_acc.username);
  elsif not v_acc.active or not v_acc.org_active then
    return jsonb_build_object('state', 'inactive', 'username', v_acc.username);
  elsif not private.session_live() then
    return jsonb_build_object('state', 'session_ended');
  elsif not private.mfa_satisfied() then
    return jsonb_build_object('state', 'mfa_required', 'username', v_acc.username);
  end if;

  select count(*) into v_new24
  from private.post_log l
  where l.org_id = v_acc.org_id and l.created_at > now() - interval '24 hours';

  return jsonb_build_object(
    'state', 'ok',
    'username', v_acc.username,
    'org', jsonb_build_object('id', v_acc.org_id, 'name', v_acc.name, 'slug', v_acc.slug,
                              'type', v_acc.type, 'campus', v_acc.campus),
    'posting_enabled', (select s.posting_enabled from public.site_settings s where s.id = 1),
    'live', (select count(*) from public.posts p where p.org_id = v_acc.org_id and p.ends_at > now()),
    'live_limit', 15,
    'new_24h', v_new24,
    'new_limit', 5,
    'next_slot_at', case when v_new24 >= 5 then (
        select min(l.created_at) + interval '24 hours'
        from private.post_log l
        where l.org_id = v_acc.org_id and l.created_at > now() - interval '24 hours') end,
    'edits_24h', (select count(*) from audit.events e
                  where e.org_id = v_acc.org_id and e.action = 'post_update'
                    and e.at > now() - interval '24 hours'),
    'edits_limit', 30,
    'factors', (select count(*) from auth.mfa_factors f
                where f.user_id = v_uid and f.status = 'verified')
  );
end
$$;
revoke all on function public.my_posting_status() from public, anon;
grant execute on function public.my_posting_status() to authenticated;
