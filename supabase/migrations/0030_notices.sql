-- 0030 — owner-only notices shown at the top of the dashboard.

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  link_url text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notices_title_len check (char_length(title) between 3 and 120),
  constraint notices_title_chars check (title !~ '[[:cntrl:]]'),
  constraint notices_body_len check (char_length(body) between 1 and 1000),
  constraint notices_body_chars check (body !~ '[\x01-\x09\x0b-\x1f\x7f]'),
  constraint notices_link_url check (
    link_url is null or (
      char_length(link_url) <= 300
      and link_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$'
    )
  ),
  constraint notices_time_order check (ends_at > starts_at),
  constraint notices_max_length check (ends_at <= starts_at + interval '180 days')
);
create index notices_ends_at on public.notices (ends_at);

alter table public.notices enable row level security;
grant select on public.notices to anon, authenticated;
grant insert (title, body, link_url, starts_at, ends_at),
      update (title, body, link_url, starts_at, ends_at),
      delete
  on public.notices to authenticated;

create policy notices_public_read on public.notices
  for select to anon, authenticated
  using (
    starts_at <= now() and ends_at > now()
    and (select s.public_reads_enabled from public.site_settings s where s.id = 1)
  );
create policy notices_owner_read on public.notices
  for select to authenticated using ((select private.is_owner()));
create policy notices_owner_insert on public.notices
  for insert to authenticated with check ((select private.is_owner()));
create policy notices_owner_update on public.notices
  for update to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create policy notices_owner_delete on public.notices
  for delete to authenticated using ((select private.is_owner()));

create trigger notices_touch before update on public.notices
  for each row execute function private.touch_updated_at();

create function private.notices_after()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.audit(case when old.ends_at < now() then 'notice_expire' else 'notice_delete' end,
      'notice', old.id, null, jsonb_build_object('title', old.title));
    return old;
  end if;
  perform private.audit(lower('notice_' || tg_op), 'notice', new.id, null,
    jsonb_build_object('title', new.title, 'starts_at', new.starts_at, 'ends_at', new.ends_at));
  return new;
end
$$;
revoke all on function private.notices_after() from public, anon, authenticated;

create trigger notices_after after insert or update or delete on public.notices
  for each row execute function private.notices_after();
