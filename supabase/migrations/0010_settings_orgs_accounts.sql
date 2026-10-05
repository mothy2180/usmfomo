-- 0010 — site settings (kill switches), organisations, posting accounts,
-- the security helpers every write policy goes through, and the audit log.

-- ---------------------------------------------------------------------------
-- Site settings: a single row with two kill switches.
-- ---------------------------------------------------------------------------
create table public.site_settings (
  id smallint primary key default 1 check (id = 1),
  posting_enabled boolean not null default true,
  public_reads_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id) values (1);

comment on column public.site_settings.posting_enabled is
  'Kill switch: false stops every club/school insert, edit and poster upload.';
comment on column public.site_settings.public_reads_enabled is
  'Degraded mode: false hides all posts and notices from the public (quota-attack runbook).';

-- ---------------------------------------------------------------------------
-- Organisations (one per club/school). Public read; written only by the owner
-- through service-only RPCs (0050).
-- ---------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    constraint orgs_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  name text not null
    constraint orgs_name_len check (char_length(name) between 2 and 100)
    constraint orgs_name_chars check (name !~ '[[:cntrl:]]'),
  type public.org_type not null,
  campus public.campus not null default 'main'
    constraint orgs_campus_physical check (campus <> 'online'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index orgs_name_unique on public.orgs (lower(name));

-- ---------------------------------------------------------------------------
-- Posting accounts. Exactly one account per org; the owner has no org.
-- Never exposed: RLS on, no policies, no grants.
-- ---------------------------------------------------------------------------
create table private.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid unique references public.orgs (id) on delete cascade,
  username text not null unique
    constraint accounts_username_format check (username ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  is_owner boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint accounts_owner_xor_org check (
    (is_owner and org_id is null) or (not is_owner and org_id is not null)
  )
);
alter table private.accounts enable row level security;

-- ---------------------------------------------------------------------------
-- Security helpers. All SECURITY DEFINER (owned by postgres, which can read
-- auth.mfa_factors and auth.sessions) with an empty search_path.
-- ---------------------------------------------------------------------------

-- True when the JWT is aal2, or when the user has no verified TOTP factor
-- (club 2FA is optional). Supabase's inline auth.mfa_factors policy pattern
-- cannot be evaluated by the authenticated role, hence this helper.
create function private.mfa_satisfied()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      );
$$;

-- True while the JWT's session still exists. A password reset or sign-out
-- deletes the session row, so already-issued access tokens stop writing at
-- once instead of after jwt_expiry.
create function private.session_live()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.user_id = (select auth.uid())
  );
$$;

-- The caller's org, or NULL unless: the account is active and not the owner,
-- the org is active, MFA is satisfied and the session is live. Every org write
-- policy (posts and storage) is "org_id = (select private.my_org_id())".
create function private.my_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select a.org_id
  from private.accounts a
  join public.orgs o on o.id = a.org_id
  where a.user_id = (select auth.uid())
    and a.active
    and not a.is_owner
    and o.active
    and private.mfa_satisfied()
    and private.session_live();
$$;

-- Owner = owner account, active, aal2 (TOTP is mandatory) and a live session.
create function private.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and private.session_live()
     and exists (
       select 1 from private.accounts a
       where a.user_id = (select auth.uid()) and a.is_owner and a.active
     );
$$;

revoke all on function private.mfa_satisfied() from public, anon, authenticated;
revoke all on function private.session_live() from public, anon, authenticated;
revoke all on function private.my_org_id() from public, anon, authenticated;
revoke all on function private.is_owner() from public, anon, authenticated;
grant execute on function private.my_org_id() to authenticated;
grant execute on function private.is_owner() to authenticated;
grant execute on function private.mfa_satisfied() to authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS for settings and orgs (helpers above must exist first).
-- ---------------------------------------------------------------------------
alter table public.site_settings enable row level security;
grant select on public.site_settings to anon, authenticated;
grant update (posting_enabled, public_reads_enabled) on public.site_settings to authenticated;

create policy site_settings_read on public.site_settings
  for select to anon, authenticated using (true);
create policy site_settings_owner_update on public.site_settings
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

alter table public.orgs enable row level security;
grant select on public.orgs to anon, authenticated;

create policy orgs_public_read on public.orgs
  for select to anon, authenticated
  using (
    active
    and (select s.public_reads_enabled from public.site_settings s where s.id = 1)
  );
create policy orgs_own_read on public.orgs
  for select to authenticated
  using (id = (select private.my_org_id()));
create policy orgs_owner_read on public.orgs
  for select to authenticated
  using ((select private.is_owner()));

-- ---------------------------------------------------------------------------
-- Append-only audit log and maintenance heartbeat (never exposed).
-- ---------------------------------------------------------------------------
create table audit.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  session_id uuid,
  org_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  changes jsonb
);
create index audit_events_org_at on audit.events (org_id, at);
create index audit_events_at on audit.events (at);
alter table audit.events enable row level security;

create function private.audit(
  p_action text, p_entity text, p_entity_id uuid, p_org_id uuid, p_changes jsonb
) returns void
language sql volatile security definer set search_path = ''
as $$
  insert into audit.events (actor, session_id, org_id, action, entity, entity_id, changes)
  values (
    (select auth.uid()),
    nullif(auth.jwt() ->> 'session_id', '')::uuid,
    p_org_id, p_action, p_entity, p_entity_id, p_changes
  );
$$;
revoke all on function private.audit(text, text, uuid, uuid, jsonb) from public, anon, authenticated;

create table private.heartbeat (
  id smallint primary key default 1 check (id = 1),
  last_run_at timestamptz,
  last_result jsonb
);
insert into private.heartbeat (id) values (1);
alter table private.heartbeat enable row level security;

-- Settings changes are audited.
create function private.site_settings_after()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.audit('settings_update', 'site_settings', null, null,
    jsonb_build_object(
      'posting_enabled', jsonb_build_array(old.posting_enabled, new.posting_enabled),
      'public_reads_enabled', jsonb_build_array(old.public_reads_enabled, new.public_reads_enabled)));
  return new;
end
$$;
revoke all on function private.site_settings_after() from public, anon, authenticated;

create function private.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

create trigger site_settings_touch before update on public.site_settings
  for each row execute function private.touch_updated_at();
create trigger site_settings_audit after update on public.site_settings
  for each row execute function private.site_settings_after();
