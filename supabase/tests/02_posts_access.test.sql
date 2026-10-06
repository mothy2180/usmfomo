-- Who can read and write which posts: public read rules, own-org writes,
-- owner moderation, session revocation, deactivation and the MFA gate.
begin;
select plan(23);

-- Fixtures (as postgres) ---------------------------------------------------
insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'ub', tests.create_user('club-b');
insert into tests.fx (k, v) select 'ob', tests.create_org_account(tests.fx('ub'), 'club-b', 'school');
insert into tests.fx (k, v) select 'sb', tests.create_session(tests.fx('ub'));
insert into tests.fx (k, v) select 'uo', tests.create_user('pgtap-owner');
select tests.create_owner(tests.fx('uo'), 'pgtap-owner');
insert into tests.fx (k, v) select 'so2', tests.create_session(tests.fx('uo'), 'aal2');
insert into tests.fx (k, v) select 'so1', tests.create_session(tests.fx('uo'), 'aal1');
insert into tests.fx (k, v) select 'um', tests.create_user('club-m');
insert into tests.fx (k, v) select 'om', tests.create_org_account(tests.fx('um'), 'club-m');
select tests.add_verified_factor(tests.fx('um'));
insert into tests.fx (k, v) select 'sm1', tests.create_session(tests.fx('um'), 'aal1');
insert into tests.fx (k, v) select 'sm2', tests.create_session(tests.fx('um'), 'aal2');

insert into tests.fx (k, v) select 'pb',
  tests.raw_post(tests.fx('ob'), now() + interval '1 day', now() + interval '1 day 2 hours');
insert into tests.fx (k, v) select 'pa_old',
  tests.raw_post(tests.fx('oa'), now() - interval '3 hours', now() - interval '1 hour');
insert into tests.fx (k, v) select 'pa_hidden',
  tests.raw_post(tests.fx('oa'), now() + interval '2 days', now() + interval '2 days 1 hour', p_hidden => true);

-- A club creates a post through the real path -------------------------------
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select lives_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Club A meetup', 'Room 1', now() + interval '1 day', now() + interval '1 day 2 hours') $$,
  'a club can create a post');
select tests.become_postgres();
insert into tests.fx (k, v) select 'pa', id from public.posts where title = 'Club A meetup';

select is((select org_id from public.posts where id = tests.fx('pa')), tests.fx('oa'),
  'the trigger assigns the club''s own org');

-- Public read ----------------------------------------------------------------
select tests.become_anon();
select is((select count(*)::int from public.posts where id = tests.fx('pa')), 1, 'anon sees a live post');
select is((select count(*)::int from public.posts where id = tests.fx('pa_old')), 0, 'anon cannot see an expired post');
select is((select count(*)::int from public.posts where id = tests.fx('pa_hidden')), 0, 'anon cannot see a hidden post');
select tests.become_postgres();

update public.orgs set active = false where id = tests.fx('ob');
select tests.become_anon();
select is((select count(*)::int from public.posts where id = tests.fx('pb')), 0,
  'anon cannot see posts of a deactivated org');
select tests.become_postgres();
update public.orgs set active = true where id = tests.fx('ob');

update public.site_settings set public_reads_enabled = false;
select tests.become_anon();
select is((select count(*)::int from public.posts), 0, 'degraded mode hides every post');
select is((select count(*)::int from public.notices), 0, 'degraded mode hides every notice');
select tests.become_postgres();
update public.site_settings set public_reads_enabled = true;

-- Own-org access --------------------------------------------------------------
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select is((select count(*)::int from public.posts where org_id = tests.fx('oa')), 3,
  'a club sees its own live, expired and hidden posts');

select results_eq(
  $$ with u as (update public.posts set title = 'pwned by A' where id = tests.fx('pb') returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'a club cannot edit another org''s post');

select results_eq(
  $$ with d as (delete from public.posts where id = tests.fx('pb') returning 1)
     select count(*)::int from d $$,
  $$ values (0) $$,
  'a club cannot delete another org''s post');

select results_eq(
  $$ with u as (update public.posts set title = 'Club A meetup (edited)' where id = tests.fx('pa') returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'a club can edit its own post');

select throws_ok(
  $$ insert into public.posts (org_id, title, venue, starts_at, ends_at)
     values (tests.fx('ob'), 'Spoof', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  '42501', null, 'a club cannot choose org_id');

select throws_ok(
  $$ update public.posts set hidden_at = now() where id = tests.fx('pa') $$,
  'P0001', 'owner_only', 'a club cannot hide posts');

select throws_ok(
  $$ update public.posts set hidden_at = null where id = tests.fx('pa_hidden') $$,
  'P0001', 'owner_only', 'a club cannot unhide its own hidden post');

-- Owner moderation ------------------------------------------------------------
select tests.authenticate_as(tests.fx('uo'), tests.fx('so2'), 'aal2');
select results_eq(
  $$ with u as (update public.posts set hidden_at = now() where id = tests.fx('pb') returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'the owner at aal2 can hide any post');

select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Owner post', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  '42501', null, 'the owner cannot post events (no org)');

select tests.authenticate_as(tests.fx('uo'), tests.fx('so1'), 'aal1');
select results_eq(
  $$ with u as (update public.posts set hidden_at = null where id = tests.fx('pb') returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'the owner at aal1 cannot moderate');

-- Revocation ------------------------------------------------------------------
select tests.become_postgres();
delete from auth.sessions where id = tests.fx('sa');
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('After logout', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  '42501', null, 'a deleted session cannot write, even with an unexpired token');

select tests.become_postgres();
insert into tests.fx (k, v) select 'sa2', tests.create_session(tests.fx('ua'));
update private.accounts set active = false where user_id = tests.fx('ua');
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa2'));
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Deactivated', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  '42501', null, 'a deactivated account cannot post');
select results_eq(
  $$ with u as (update public.posts set title = 'still here?' where id = tests.fx('pa') returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'a deactivated account cannot edit');

-- MFA gate --------------------------------------------------------------------
select tests.authenticate_as(tests.fx('um'), tests.fx('sm1'), 'aal1');
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('MFA post', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  '42501', null, 'with a verified factor, an aal1 session cannot post');

select tests.authenticate_as(tests.fx('um'), tests.fx('sm2'), 'aal2');
select lives_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('MFA post', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  'with a verified factor, an aal2 session can post');

select * from finish();
rollback;
