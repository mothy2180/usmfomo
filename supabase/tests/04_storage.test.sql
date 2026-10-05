-- Posters bucket: own-folder uploads only, exact names, caps, kill switch, MFA.
begin;
select plan(16);

insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'ub', tests.create_user('club-b');
insert into tests.fx (k, v) select 'ob', tests.create_org_account(tests.fx('ub'), 'club-b');
insert into tests.fx (k, v) select 'sb', tests.create_session(tests.fx('ub'));
insert into tests.fx (k, v) select 'um', tests.create_user('club-m');
insert into tests.fx (k, v) select 'om', tests.create_org_account(tests.fx('um'), 'club-m');
select tests.add_verified_factor(tests.fx('um'));
insert into tests.fx (k, v) select 'sm1', tests.create_session(tests.fx('um'), 'aal1');

select is(
  (select array[public::text, file_size_limit::text, array_to_string(allowed_mime_types, ',')]
   from storage.buckets where id = 'posters'),
  array['true', '2097152', 'image/webp,image/jpeg'],
  'posters bucket: public, 2 MiB, WebP/JPEG only');

-- Club A uploads -------------------------------------------------------------------
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select lives_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 1000}') $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '.webp', tests.fx('ua')),
  'a club can upload a poster into its own folder');
select lives_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 500}') $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '-thumb.jpg', tests.fx('ua')),
  'a club can upload a JPEG thumbnail into its own folder');
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 1000}') $f$,
  tests.fx('ob') || '/' || gen_random_uuid() || '.webp', tests.fx('ua')),
  '42501', null, 'a club cannot upload into another org''s folder');
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 1000}') $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '.svg', tests.fx('ua')),
  '42501', null, 'SVG (or any other extension) is refused');
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 1000}') $f$,
  tests.fx('oa') || '/sub/' || gen_random_uuid() || '.webp', tests.fx('ua')),
  '42501', null, 'nested folders are refused');
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('posters', %L, %L, '{"size": 1000}') $f$,
  tests.fx('oa') || '/../' || tests.fx('ob') || '/' || gen_random_uuid() || '.webp', tests.fx('ua')),
  '42501', null, 'path traversal names are refused');

select is((select count(*)::int from storage.objects where bucket_id = 'posters'), 2,
  'a club can list only its own objects');

-- Club B cannot see or delete A's files ---------------------------------------------
select tests.authenticate_as(tests.fx('ub'), tests.fx('sb'));
select is((select count(*)::int from storage.objects where bucket_id = 'posters'), 0,
  'another club cannot list A''s objects');
set local storage.allow_delete_query = 'true';
select results_eq(
  $$ with d as (delete from storage.objects where bucket_id = 'posters' returning 1) select count(*)::int from d $$,
  $$ values (0) $$,
  'another club cannot delete A''s objects');

select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select results_eq(
  $$ with d as (delete from storage.objects
                where bucket_id = 'posters' and name like '%-thumb.jpg' returning 1)
     select count(*)::int from d $$,
  $$ values (1) $$,
  'a club can delete its own object');
reset storage.allow_delete_query;

-- anon, MFA, kill switch, caps -------------------------------------------------------
select tests.become_anon();
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, metadata) values ('posters', %L, '{"size": 1}') $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '.webp'),
  '42501', null, 'anon cannot upload');

select tests.authenticate_as(tests.fx('um'), tests.fx('sm1'), 'aal1');
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('posters', %L, %L, '{"size": 1}') $f$,
  tests.fx('om') || '/' || gen_random_uuid() || '.webp', tests.fx('um')),
  '42501', null, 'with a verified factor, an aal1 session cannot upload');

select tests.become_postgres();
update public.site_settings set posting_enabled = false;
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('posters', %L, %L, '{"size": 1}') $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '.webp', tests.fx('ua')),
  '42501', null, 'no uploads while posting is paused');
select tests.become_postgres();
update public.site_settings set posting_enabled = true;

-- A now has 1 object; add 39 more -> 40 = the per-org cap.
select tests.raw_object(tests.fx('oa') || '/' || gen_random_uuid() || '.webp') from generate_series(1, 39);
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('posters', %L, %L, '{"size": 1}') $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '.webp', tests.fx('ua')),
  '42501', null, 'the 41st object in an org folder is refused');

-- Whole bucket over 800 MiB -> every upload is refused.
select tests.become_postgres();
select tests.raw_object(tests.fx('om') || '/' || gen_random_uuid() || '.webp', 900 * 1024 * 1024);
select tests.authenticate_as(tests.fx('ub'), tests.fx('sb'));
select throws_ok(format(
  $f$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('posters', %L, %L, '{"size": 1}') $f$,
  tests.fx('ob') || '/' || gen_random_uuid() || '.webp', tests.fx('ub')),
  '42501', null, 'uploads stop when the bucket passes 800 MiB');

select * from finish();
rollback;
