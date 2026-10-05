-- Owner-only notices and kill switches.
begin;
select plan(13);

insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'uo', tests.create_user('owner');
select tests.create_owner(tests.fx('uo'));
insert into tests.fx (k, v) select 'so2', tests.create_session(tests.fx('uo'), 'aal2');
insert into tests.fx (k, v) select 'so1', tests.create_session(tests.fx('uo'), 'aal1');

delete from public.notices;
insert into public.notices (id, title, body, starts_at, ends_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Live notice', 'Now', now() - interval '1 hour', now() + interval '1 day'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Future notice', 'Later', now() + interval '1 day', now() + interval '2 days'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'Old notice', 'Gone', now() - interval '2 days', now() - interval '1 day');

select tests.become_anon();
select results_eq($$ select title from public.notices order by title $$, $$ values ('Live notice'::text) $$,
  'anon sees only notices inside their show window');

select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok(
  $$ insert into public.notices (title, body, ends_at) values ('Club notice', 'x', now() + interval '1 day') $$,
  '42501', null, 'a club cannot post a notice');
select results_eq(
  $$ with u as (update public.notices set title = 'Hacked' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'a club cannot edit notices');
select results_eq(
  $$ with u as (update public.site_settings set posting_enabled = false returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'a club cannot flip the kill switches');

select tests.authenticate_as(tests.fx('uo'), tests.fx('so1'), 'aal1');
select throws_ok(
  $$ insert into public.notices (title, body, ends_at) values ('aal1 notice', 'x', now() + interval '1 day') $$,
  '42501', null, 'the owner at aal1 cannot post a notice');

select tests.authenticate_as(tests.fx('uo'), tests.fx('so2'), 'aal2');
select lives_ok(
  $$ insert into public.notices (title, body, ends_at) values ('Owner notice', 'Hello', now() + interval '1 day') $$,
  'the owner at aal2 can post a notice');
select is((select count(*)::int from public.notices), 4, 'the owner sees every notice, including future and old ones');
select results_eq(
  $$ with u as (update public.notices set body = 'Edited' where title = 'Owner notice' returning 1) select count(*)::int from u $$,
  $$ values (1) $$, 'the owner can edit a notice');
select results_eq(
  $$ with d as (delete from public.notices where title = 'Future notice' returning 1) select count(*)::int from d $$,
  $$ values (1) $$, 'the owner can delete a notice');
select throws_ok(
  $$ insert into public.notices (title, body, ends_at, link_url)
     values ('Bad link', 'x', now() + interval '1 day', 'javascript:alert(1)') $$,
  '23514', null, 'notice links must be https');
select results_eq(
  $$ with u as (update public.site_settings set posting_enabled = false returning 1) select count(*)::int from u $$,
  $$ values (1) $$, 'the owner at aal2 can flip the kill switch');

select tests.become_anon();
select throws_ok(
  $$ update public.site_settings set public_reads_enabled = false $$,
  '42501', null, 'anon cannot touch site settings');

select tests.become_postgres();
select is((select count(*)::int from audit.events where action = 'settings_update'), 1,
  'kill-switch changes are audited');

select * from finish();
rollback;
