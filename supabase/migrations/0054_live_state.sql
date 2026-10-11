-- 0054 — Live updates without Realtime.
--
-- Open pages poll this one tiny row (about 0.2 KB) and reload their lists only
-- when changed_at moves. Any write to posts, notices or orgs moves it, and so
-- does switching public reads on or off. Events that simply end are not
-- writes: the pages drop those themselves at their end time.
--
-- poll_seconds is the owner's valve on Supabase egress (5 GB/month on Free):
-- every open page picks up a new value on its next check. 0 = live updates off.
--
-- A table of its own rather than columns on site_settings: the kill-switch
-- triggers there (audit, updated_at) must not run on every post write, and
-- club writes must not queue behind the kill-switch row.

create table public.live_state (
  id smallint primary key default 1 check (id = 1),
  changed_at timestamptz not null default now(),
  poll_seconds smallint not null default 30
    constraint live_state_poll_seconds check (poll_seconds in (0, 30, 60, 120, 300))
);
insert into public.live_state (id) values (1);

comment on column public.live_state.changed_at is
  'When anything the public pages show last changed. Pages poll it and reload on change.';
comment on column public.live_state.poll_seconds is
  'How often open pages check changed_at (0 = live updates off). Raise it if egress runs high.';

alter table public.live_state enable row level security;
grant select on public.live_state to anon, authenticated;
grant update (poll_seconds) on public.live_state to authenticated;

create policy live_state_read on public.live_state
  for select to anon, authenticated using (true);
create policy live_state_owner_update on public.live_state
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

-- Moves changed_at. Row-level, so a statement that touches no rows (the hourly
-- purge on a quiet hour) doesn't make every open page reload; the second and
-- later rows of a transaction skip the write (now() is fixed per transaction).
-- Runs as postgres: clubs have no write grant on live_state.
create function private.bump_live_state()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.live_state set changed_at = now() where id = 1 and changed_at is distinct from now();
  return null;
end
$$;
revoke all on function private.bump_live_state() from public, anon, authenticated;

create trigger posts_live after insert or update or delete on public.posts
  for each row execute function private.bump_live_state();
create trigger notices_live after insert or update or delete on public.notices
  for each row execute function private.bump_live_state();
create trigger orgs_live after insert or update or delete on public.orgs
  for each row execute function private.bump_live_state();
create trigger site_settings_live after update of public_reads_enabled on public.site_settings
  for each row when (old.public_reads_enabled is distinct from new.public_reads_enabled) execute function private.bump_live_state();

-- Interval changes are audited like the kill switches.
create function private.live_state_after()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.audit('settings_update', 'live_state', null, null,
    jsonb_build_object('poll_seconds', jsonb_build_array(old.poll_seconds, new.poll_seconds)));
  return new;
end
$$;
revoke all on function private.live_state_after() from public, anon, authenticated;

create trigger live_state_audit after update of poll_seconds on public.live_state
  for each row when (old.poll_seconds is distinct from new.poll_seconds)
  execute function private.live_state_after();
