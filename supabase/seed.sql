-- Local + CI only. `supabase db push` never runs seeds, so nothing here can
-- reach production. Two parts: pgTAP helpers (schema "tests") and sample data
-- for the dashboard. Demo LOGIN accounts are created through the Auth Admin API
-- instead (`pnpm account seed-local`), so the real code path is exercised.

-- ---------------------------------------------------------------------------
-- pgTAP helpers
-- ---------------------------------------------------------------------------
create extension if not exists pgtap with schema extensions;

-- Migration 0001 revokes EXECUTE-to-PUBLIC on new functions, so the pgTAP
-- functions created just now need explicit grants for tests that switch roles.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join pg_extension e on e.oid = d.refobjid
    where e.extname = 'pgtap'
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end
$$;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Named fixtures shared between statements of one test file (rolled back).
create table if not exists tests.fx (k text primary key, v uuid not null);
grant select on tests.fx to anon, authenticated, service_role;

create or replace function tests.fx(p_k text)
returns uuid
language sql stable
set search_path = ''
as $$ select v from tests.fx where k = p_k $$;

-- A bare auth user (no password; tests never sign in through Auth).
create or replace function tests.create_user(p_username text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_username || '@usmfomo.pages.dev', '', now(), now(), now(),
          '{"provider":"email","providers":["email"]}', '{}');
  return v_id;
end
$$;

-- An org + its posting account; returns the org id.
create or replace function tests.create_org_account(
  p_user uuid, p_username text, p_type public.org_type default 'club'
) returns uuid
language sql security definer set search_path = ''
as $$
  select public.admin_create_org_account(p_user, p_username, 'Org ' || p_username,
                                         'org-' || p_username, p_type, 'main');
$$;

create or replace function tests.create_owner(p_user uuid, p_username text default 'owner')
returns void
language sql security definer set search_path = ''
as $$ select public.admin_link_owner(p_user, p_username); $$;

-- A live auth session row; returns its id (put it in the JWT claims).
create or replace function tests.create_session(p_user uuid, p_aal text default 'aal1')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v_id, p_user, now(), now(), p_aal::auth.aal_level);
  return v_id;
end
$$;

-- A verified TOTP factor (enough for private.mfa_satisfied to demand aal2).
create or replace function tests.add_verified_factor(p_user uuid, p_name text default 'phone')
returns void
language sql security definer set search_path = ''
as $$
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), p_user, p_name, 'totp', 'verified', now(), now());
$$;

-- Become a signed-in user for the rest of the transaction.
create or replace function tests.authenticate_as(p_user uuid, p_session uuid, p_aal text default 'aal1')
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal,
                      'session_id', p_session)::text, true);
  perform set_config('role', 'authenticated', true);
end
$$;

create or replace function tests.become_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end
$$;

create or replace function tests.become_postgres()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end
$$;

create or replace function tests.become_service()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end
$$;

-- Insert a post directly (no guard trigger), e.g. an already-expired one.
create or replace function tests.raw_post(
  p_org uuid, p_starts timestamptz, p_ends timestamptz,
  p_poster text default null, p_thumb text default null, p_title text default 'Raw post',
  p_hidden boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  alter table public.posts disable trigger posts_guard;
  insert into public.posts (id, org_id, title, venue, starts_at, ends_at, poster_path, thumb_path, hidden_at)
  values (v_id, p_org, p_title, 'Somewhere', p_starts, p_ends, p_poster, p_thumb,
          case when p_hidden then now() end);
  alter table public.posts enable trigger posts_guard;
  return v_id;
end
$$;

-- Run SQL with the posts guard trigger disabled (postgres only), e.g. to
-- backdate created_at.
create or replace function tests.raw_exec(p_sql text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  alter table public.posts disable trigger posts_guard;
  execute p_sql;
  alter table public.posts enable trigger posts_guard;
end
$$;

-- A storage object row (as the Storage API would create it).
create or replace function tests.raw_object(p_name text, p_size bigint default 1000, p_created timestamptz default now())
returns void
language sql security definer set search_path = ''
as $$
  insert into storage.objects (bucket_id, name, metadata, created_at)
  values ('posters', p_name, jsonb_build_object('size', p_size, 'mimetype', 'image/webp'), p_created);
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
revoke execute on function tests.raw_exec(text) from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sample dashboard data (relative to reset time, so it is always upcoming).
-- ---------------------------------------------------------------------------
set usmfomo.bypass_limits = 'on';

insert into public.orgs (id, slug, name, type, campus) values
  ('11111111-1111-4111-8111-111111111111', 'computer-science-society', 'Computer Science Society', 'club', 'main'),
  ('22222222-2222-4222-8222-222222222222', 'robotics-club', 'Robotics Club', 'club', 'engineering'),
  ('33333333-3333-4333-8333-333333333333', 'desasiswa-tekun', 'Desasiswa Tekun Committee', 'club', 'main'),
  ('44444444-4444-4444-8444-444444444444', 'school-of-computer-sciences', 'School of Computer Sciences', 'school', 'main'),
  ('55555555-5555-4555-8555-555555555555', 'school-of-medical-sciences', 'School of Medical Sciences', 'school', 'health');

insert into public.posts (org_id, campus, title, venue, description, link_url, starts_at, ends_at) values
  ('11111111-1111-4111-8111-111111111111', 'main', 'Hack Night: build something in 6 hours',
   'Dewan Kuliah A, Main Campus', 'Bring a laptop. Snacks provided. Teams of up to 4.',
   'https://forms.gle/example', date_trunc('hour', now()) + interval '2 days 19 hours', date_trunc('hour', now()) + interval '3 days 1 hour'),
  ('11111111-1111-4111-8111-111111111111', 'online', 'Intro to Git workshop',
   'Online (Google Meet)', null, null,
   date_trunc('hour', now()) + interval '1 hour', date_trunc('hour', now()) + interval '3 hours'),
  ('22222222-2222-4222-8222-222222222222', 'engineering', 'Line-follower robot competition',
   'Engineering Campus Main Hall', 'Open to all USM students. Registration closes Friday.',
   'https://forms.gle/example2', date_trunc('day', now()) + interval '5 days 9 hours', date_trunc('day', now()) + interval '5 days 17 hours'),
  ('33333333-3333-4333-8333-333333333333', 'main', 'Malam Kebudayaan Desasiswa',
   'Desasiswa Tekun Courtyard', 'Cultural night with food stalls and performances.', null,
   date_trunc('day', now()) + interval '8 days 20 hours', date_trunc('day', now()) + interval '8 days 23 hours'),
  ('44444444-4444-4444-8444-444444444444', 'main', 'Final Year Project Exhibition',
   'School of Computer Sciences Foyer', 'Three days of student project demos. Free entry.', null,
   date_trunc('day', now()) + interval '10 hours', date_trunc('day', now()) + interval '2 days 17 hours'),
  ('55555555-5555-4555-8555-555555555555', 'health', 'Public health talk: sleep and exams',
   'Health Campus Auditorium', null, null,
   date_trunc('day', now()) + interval '12 days 14 hours', date_trunc('day', now()) + interval '12 days 16 hours');

insert into public.notices (title, body, link_url, starts_at, ends_at) values
  ('Welcome to usmfomo', 'Club and school events at USM in one place. No sign-up needed.', null,
   now() - interval '1 hour', now() + interval '30 days');

reset usmfomo.bypass_limits;
