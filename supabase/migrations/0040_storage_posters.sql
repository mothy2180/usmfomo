-- 0040 — public "posters" bucket and its storage.objects policies.
--
-- The browser accepts originals up to 10 MB and re-encodes them to a WebP/JPEG
-- poster (long edge <= 1600 px, <= 1.5 MiB) plus a 360 px thumbnail, so the
-- stored objects are small. allowed_mime_types is checked against the client's
-- Content-Type header only, so it is an allowlist without SVG/PNG/HTML.
-- Object names: <org_id>/<uuid>.webp|jpg and <org_id>/<uuid>-thumb.webp|jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Upload gate: posting enabled, an active MFA-satisfied org session, fewer
-- than 40 objects in the org's folder (15 live posts x 2 files + spare) and the
-- whole bucket under 800 MiB, so one leaked password cannot fill the free 1 GB.
create function private.can_upload_poster()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.posting_enabled from public.site_settings s where s.id = 1), false)
     and private.my_org_id() is not null
     and (select count(*)
          from storage.objects o
          where o.bucket_id = 'posters'
            and (storage.foldername(o.name))[1] = private.my_org_id()::text) < 40
     and (select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
          from storage.objects o
          where o.bucket_id = 'posters') < 800 * 1024 * 1024;
$$;
revoke all on function private.can_upload_poster() from public, anon, authenticated;
grant execute on function private.can_upload_poster() to authenticated;

-- Public read happens through the public-bucket URL (no SELECT policy needed);
-- there is deliberately no bucket-wide SELECT, so nobody can list the bucket.
create policy posters_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'posters'
    and (storage.foldername(name))[1] = (select private.my_org_id())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}(-thumb)?\.(webp|jpg)$'
    and (select private.can_upload_poster())
  );

-- remove() needs SELECT + DELETE on the rows it deletes. No UPDATE policy:
-- uploads use upsert:false and a new random name every time.
create policy posters_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'posters'
    and (storage.foldername(name))[1] = (select private.my_org_id())::text
  );

create policy posters_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'posters'
    and (storage.foldername(name))[1] = (select private.my_org_id())::text
  );
