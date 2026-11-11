-- 0057 — registration by email and by QR image on a post.
--
-- A club can tell students how to register in three ways, all optional and in
-- any mix: the existing link (link_url), a contact email, and a QR image. The
-- QR image is a third file per post, stored in the same public "posters" bucket
-- as <org_id>/<uuid>-qr.webp|jpg. The email and the QR are public by design
-- (they appear on the public event page), like the poster itself.

alter table public.posts
  add column contact_email text,
  add column qr_path text;

-- ASCII only, like link_url (an internationalised domain must be punycode).
-- Not a full RFC 5322 check: it only has to stop junk, the club owns the address.
alter table public.posts
  add constraint posts_contact_email check (
    contact_email is null or (
      char_length(contact_email) <= 254
      and contact_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$'
    )
  ),
  -- Exactly the club's own folder, no "../" tricks. org_id is filled in by the
  -- posts_guard BEFORE trigger, which runs before CHECK constraints.
  add constraint posts_qr_path check (
    qr_path is null or qr_path ~ ('^' || org_id::text || '/[0-9a-f-]{36}-qr\.(webp|jpg)$')
  );

grant insert (contact_email, qr_path), update (contact_email, qr_path) on public.posts to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: the upload policy accepts the "-qr" name, and the per-org object cap
-- grows from 40 (15 live posts x 2 files + spare) to 55 (15 x 3 + spare). The
-- 800 MiB bucket cap is unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.can_upload_poster()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.posting_enabled from public.site_settings s where s.id = 1), false)
     and private.my_org_id() is not null
     and (select count(*)
          from storage.objects o
          where o.bucket_id = 'posters'
            and (storage.foldername(o.name))[1] = private.my_org_id()::text) < 55
     and (select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
          from storage.objects o
          where o.bucket_id = 'posters') < 800 * 1024 * 1024;
$$;

alter policy posters_insert_own on storage.objects
  with check (
    bucket_id = 'posters'
    and (storage.foldername(name))[1] = (select private.my_org_id())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}(-thumb|-qr)?\.(webp|jpg)$'
    and (select private.can_upload_poster())
  );

-- ---------------------------------------------------------------------------
-- Clean-up: the QR file must go with its post (hourly purge, owner delete) and
-- must not be swept as an orphan while a post still references it.
-- Same signatures and return types, so CREATE OR REPLACE works; the purge result
-- only gains a "qr_path" key, which older callers simply ignore.
-- ---------------------------------------------------------------------------
create or replace function public.maint_purge_expired(p_limit int default 100)
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
    returning p.id, p.poster_path, p.thumb_path, p.qr_path
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'post', 'id', del.id, 'poster_path', del.poster_path,
           'thumb_path', del.thumb_path, 'qr_path', del.qr_path)), '[]'::jsonb)
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
           'kind', 'notice', 'id', del.id, 'poster_path', null, 'thumb_path', null, 'qr_path', null)), '[]'::jsonb)
    into v_notices
  from del;

  return v_posts || v_notices;
end
$$;

create or replace function public.maint_orphans(p_older_than interval default interval '24 hours', p_limit int default 500)
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
        where p.poster_path = o.name or p.thumb_path = o.name or p.qr_path = o.name
      )
    order by o.created_at, o.name
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  ) d;
$$;

-- The return type gains a column, so drop and recreate (as 0053 did).
drop function public.admin_delete_post(uuid);

create function public.admin_delete_post(p_post uuid)
returns table (poster_path text, thumb_path text, qr_path text)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.bypass_limits();
  return query
  delete from public.posts p where p.id = p_post
  returning p.poster_path, p.thumb_path, p.qr_path;
end
$$;

-- EXECUTE: service_role only (as in 0050 and 0051).
revoke all on function public.admin_delete_post(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_post(uuid) to service_role;
