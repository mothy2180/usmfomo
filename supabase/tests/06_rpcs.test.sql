-- Read RPCs (search, status) and the service-only maintenance/admin RPCs.
begin;
select plan(21);

delete from public.posts;
insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'us', tests.create_user('school-s');
insert into tests.fx (k, v) select 'os', tests.create_org_account(tests.fx('us'), 'school-s', 'school');
insert into tests.fx (k, v) select 'um', tests.create_user('club-m');
insert into tests.fx (k, v) select 'om', tests.create_org_account(tests.fx('um'), 'club-m');
select tests.add_verified_factor(tests.fx('um'));
insert into tests.fx (k, v) select 'sm1', tests.create_session(tests.fx('um'), 'aal1');
insert into tests.fx (k, v) select 'uo', tests.create_user('pgtap-owner');
select tests.create_owner(tests.fx('uo'), 'pgtap-owner');
insert into tests.fx (k, v) select 'so2', tests.create_session(tests.fx('uo'), 'aal2');

insert into tests.fx (k, v) select 'p_now',
  tests.raw_post(tests.fx('oa'), now() - interval '1 hour', now() + interval '1 hour', p_title => 'Happening now');
insert into tests.fx (k, v) select 'p_soon',
  tests.raw_post(tests.fx('oa'), now() + interval '1 hour', now() + interval '2 hours', p_title => 'Fun % party');
insert into tests.fx (k, v) select 'p_later',
  tests.raw_post(tests.fx('oa'), now() + interval '3 days', now() + interval '3 days 1 hour', p_title => 'Robot night');
insert into tests.fx (k, v) select 'p_hidden',
  tests.raw_post(tests.fx('oa'), now() + interval '1 day', now() + interval '1 day 1 hour', p_title => 'Hidden one', p_hidden => true);
insert into tests.fx (k, v) select 'p_school',
  tests.raw_post(tests.fx('os'), now() + interval '2 days', now() + interval '2 days 1 hour', p_title => 'School talk');
insert into tests.fx (k, v) select 'p_expired',
  tests.raw_post(tests.fx('oa'), now() - interval '5 hours', now() - interval '4 hours',
                 tests.fx('oa') || '/11111111-1111-4111-8111-111111111111.webp',
                 tests.fx('oa') || '/11111111-1111-4111-8111-111111111111-thumb.webp', 'Expired');

-- search_posts ------------------------------------------------------------------------
select tests.become_anon();
select results_eq(
  $$ select title from public.search_posts('club') $$,
  $$ values ('Happening now'::text), ('Fun % party'), ('Robot night') $$,
  'club panel: happening now first, then upcoming by start; no hidden/expired/school posts');
select results_eq(
  $$ select title from public.search_posts('school') $$,
  $$ values ('School talk'::text) $$,
  'school panel shows only school posts');
select results_eq(
  $$ select title from public.search_posts('club', '%') $$,
  $$ values ('Fun % party'::text) $$,
  'a literal % in the search box is escaped');
select results_eq(
  $$ select title from public.search_posts('club', 'org club-a') $$,
  $$ values ('Happening now'::text), ('Fun % party'), ('Robot night') $$,
  'search matches the organiser name');
select is((select total::int from public.search_posts('club', p_limit => 1) limit 1), 3,
  'paging returns the full total with each page');
select results_eq(
  $$ select title from public.search_posts('club', p_limit => 1, p_offset => 1) $$,
  $$ values ('Fun % party'::text) $$,
  'offset paging works');

select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select is((select count(*)::int from public.search_posts('club') where title in ('Hidden one', 'Expired')), 0,
  'a signed-in club never sees its own hidden/expired posts in the public panels');

-- my_posting_status ----------------------------------------------------------------------
select is((public.my_posting_status() ->> 'state'), 'ok', 'status: an active club is ok');
select is((public.my_posting_status() ->> 'live')::int, 4, 'status: live count includes hidden but not expired posts');
select tests.authenticate_as(tests.fx('um'), tests.fx('sm1'), 'aal1');
select is((public.my_posting_status() ->> 'state'), 'mfa_required', 'status: a factor without aal2 asks for the code');
select tests.authenticate_as(tests.fx('uo'), tests.fx('so2'), 'aal2');
select is((public.my_posting_status() ->> 'state'), 'owner', 'status: owner is told to use the owner console');
select tests.become_anon();
select throws_ok($$ select public.my_posting_status() $$, '42501', null, 'anon cannot call my_posting_status');

-- Service-only RPCs -------------------------------------------------------------------------
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok($$ select * from public.maint_purge_expired() $$, '42501', null,
  'a club cannot run maintenance');
select throws_ok($$ select * from public.admin_list_accounts() $$, '42501', null,
  'a club cannot list accounts');

select tests.become_postgres();
insert into public.notices (title, body, starts_at, ends_at)
values ('Old notice', 'x', now() - interval '2 days', now() - interval '1 day');
select tests.raw_object(tests.fx('oa') || '/22222222-2222-4222-8222-222222222222.webp', 1000, now() - interval '2 days');
select tests.raw_object(tests.fx('oa') || '/33333333-3333-4333-8333-333333333333.webp', 1000, now());
insert into private.post_log (org_id, post_id, created_at) values (tests.fx('oa'), gen_random_uuid(), now() - interval '3 days');

select tests.become_service();
select results_eq(
  $$ select e ->> 'kind', e ->> 'poster_path', e ->> 'thumb_path'
     from jsonb_array_elements(public.maint_purge_expired()) e order by 1 $$,
  format($f$ values ('notice'::text, null::text, null::text), ('post', %L, %L) $f$,
         tests.fx('oa') || '/11111111-1111-4111-8111-111111111111.webp',
         tests.fx('oa') || '/11111111-1111-4111-8111-111111111111-thumb.webp'),
  'maintenance deletes expired posts and notices and returns their files (one jsonb array)');
select throws_ok($$ select count(*) from public.posts $$, '42501', null,
  'the service role has no direct table access (RPCs only)');
select tests.become_postgres();
select is((select count(*)::int from public.posts), 5, 'live and hidden posts survive maintenance');
select tests.become_service();
select is(
  public.maint_orphans(),
  jsonb_build_array(tests.fx('oa') || '/22222222-2222-4222-8222-222222222222.webp'),
  'orphan sweep finds unreferenced files older than 24 h only (one jsonb array of names)');
select is((public.maint_retention() ->> 'post_log')::int, 1, 'retention removes post_log rows older than 2 days');
select ok(public.maint_heartbeat() is not null, 'heartbeat records the run');
select is(
  (select factor_count from public.admin_list_accounts() where username = 'club-m'), 1,
  'admin_list_accounts reports verified factor counts');

select * from finish();
rollback;
