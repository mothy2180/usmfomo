-- Registration (0057): an optional contact email and QR image on a post. Both are
-- written by the club, public on the event page, and the QR file is cleaned up
-- with its post.
begin;
select plan(13);

insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'ub', tests.create_user('club-b');
insert into tests.fx (k, v) select 'ob', tests.create_org_account(tests.fx('ub'), 'club-b');

select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));

-- Writing the columns ------------------------------------------------------------------
select lives_ok(format(
  $f$ insert into public.posts (campus, title, venue, starts_at, ends_at, contact_email, qr_path)
      values ('main', 'QR talk', 'DK A', now() + interval '1 day', now() + interval '1 day 2 hours',
              'reg@club.example', %L) $f$,
  tests.fx('oa') || '/44444444-4444-4444-8444-444444444444-qr.webp'),
  'a club can post with a contact email and a QR image in its own folder');

select throws_ok(
  $f$ insert into public.posts (campus, title, venue, starts_at, ends_at, contact_email)
      values ('main', 'Bad mail', 'DK A', now() + interval '1 day', now() + interval '1 day 2 hours', 'not an email') $f$,
  '23514', null, 'a contact email must look like an address');

select throws_ok(
  $f$ insert into public.posts (campus, title, venue, starts_at, ends_at, contact_email)
      values ('main', 'Bad mail 2', 'DK A', now() + interval '1 day', now() + interval '1 day 2 hours', E'a@club.example\nb@x.com') $f$,
  '23514', null, 'a contact email cannot hold a line break (no header tricks)');

select throws_ok(format(
  $f$ insert into public.posts (campus, title, venue, starts_at, ends_at, qr_path)
      values ('main', 'Other folder', 'DK A', now() + interval '1 day', now() + interval '1 day 2 hours', %L) $f$,
  tests.fx('ob') || '/44444444-4444-4444-8444-444444444444-qr.webp'),
  '23514', null, 'a QR image path must be in the club''s own folder');

select throws_ok(format(
  $f$ insert into public.posts (campus, title, venue, starts_at, ends_at, qr_path)
      values ('main', 'Wrong name', 'DK A', now() + interval '1 day', now() + interval '1 day 2 hours', %L) $f$,
  tests.fx('oa') || '/44444444-4444-4444-8444-444444444444.webp'),
  '23514', null, 'a QR image path must be a "-qr" file name');

-- Public read ----------------------------------------------------------------------------
select tests.become_anon();
select is(
  (select p.contact_email || ' ' || p.qr_path from public.posts p where p.title = 'QR talk'),
  'reg@club.example ' || (select tests.fx('oa')::text) || '/44444444-4444-4444-8444-444444444444-qr.webp',
  'anyone can read the email and QR path of a public post');

-- Editing ---------------------------------------------------------------------------------
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select lives_ok(format(
  $f$ update public.posts set contact_email = 'new@club.example', qr_path = %L where title = 'QR talk' $f$,
  tests.fx('oa') || '/77777777-7777-4777-8777-777777777777-qr.webp'),
  'a club can change the email and replace the QR image');

-- Storage: the QR file name ---------------------------------------------------------------
select lives_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 2000}') $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '-qr.webp', tests.fx('ua')),
  'a club can upload a QR image into its own folder');

select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 2000}') $f$,
  tests.fx('ob') || '/' || gen_random_uuid() || '-qr.webp', tests.fx('ua')),
  '42501', null, 'a club cannot upload a QR image into another org''s folder');

select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 2000}') $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '-qr.png', tests.fx('ua')),
  '42501', null, 'a QR file name must end in .webp or .jpg');

-- Clean-up ---------------------------------------------------------------------------------
select tests.become_postgres();
insert into tests.fx (k, v) select 'p_qr', p.id from public.posts p where p.title = 'QR talk';
-- A referenced QR file and an unreferenced one, both older than 24 h.
select tests.raw_object(tests.fx('oa') || '/77777777-7777-4777-8777-777777777777-qr.webp', 1000, now() - interval '2 days');
select tests.raw_object(tests.fx('oa') || '/66666666-6666-4666-8666-666666666666-qr.webp', 1000, now() - interval '2 days');
insert into tests.fx (k, v) select 'p_old',
  tests.raw_post(tests.fx('oa'), now() - interval '5 hours', now() - interval '4 hours', p_title => 'Old QR event');
select tests.raw_exec(format($f$ update public.posts set qr_path = %L where id = %L $f$,
  tests.fx('oa') || '/55555555-5555-4555-8555-555555555555-qr.webp', tests.fx('p_old')));

select tests.become_service();
select is(
  public.maint_orphans(),
  jsonb_build_array(tests.fx('oa') || '/66666666-6666-4666-8666-666666666666-qr.webp'),
  'the orphan sweep keeps a QR file a post still uses and removes an unreferenced one');

select is(
  (select e ->> 'qr_path' from jsonb_array_elements(public.maint_purge_expired()) e
   where e ->> 'kind' = 'post' and e ->> 'id' = tests.fx('p_old')::text),
  tests.fx('oa') || '/55555555-5555-4555-8555-555555555555-qr.webp',
  'the hourly purge returns the QR file of an expired post so it is deleted too');

select is(
  (select d.qr_path from public.admin_delete_post(tests.fx('p_qr')) d),
  tests.fx('oa') || '/77777777-7777-4777-8777-777777777777-qr.webp',
  'an owner delete returns the QR file so it is removed with the post');

select * from finish();
rollback;
