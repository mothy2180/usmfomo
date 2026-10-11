-- Live updates: every change the public sees moves live_state.changed_at;
-- only the owner sets the poll interval.
begin;
select plan(14);

insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'uo', tests.create_user('pgtap-owner');
select tests.create_owner(tests.fx('uo'), 'pgtap-owner');
insert into tests.fx (k, v) select 'so2', tests.create_session(tests.fx('uo'), 'aal2');

-- now() is fixed inside the test transaction: rewind changed_at before each
-- write and check that the write moved it back to now().
create function tests.rewind_live() returns void language sql as $$
  update public.live_state set changed_at = '2000-01-01Z' where id = 1
$$;
create function tests.live_moved() returns boolean language sql as $$
  select changed_at = now() from public.live_state where id = 1
$$;

select tests.become_anon();
select is((select poll_seconds from public.live_state), 30::smallint, 'anon can read the live state (30 s by default)');
select throws_ok($$ update public.live_state set changed_at = now() $$, '42501', null, 'anon cannot move changed_at');

select tests.become_postgres();
select tests.rewind_live();
delete from public.posts where false;
select ok(not tests.live_moved(), 'a statement that changes no rows leaves changed_at alone');

select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select lives_ok(
  $$ insert into public.posts (campus, title, venue, starts_at, ends_at)
     values ('main', 'Live talk', 'DK A', now() + interval '1 day', now() + interval '1 day 2 hours') $$,
  'a club posts');
select tests.become_postgres();
select ok(tests.live_moved(), 'a new post moves changed_at');

select tests.rewind_live();
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
update public.posts set venue = 'DK B' where title = 'Live talk';
select tests.become_postgres();
select ok(tests.live_moved(), 'an edit moves changed_at');

select tests.rewind_live();
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
delete from public.posts where title = 'Live talk';
select tests.become_postgres();
select ok(tests.live_moved(), 'a delete moves changed_at');

select tests.rewind_live();
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select results_eq(
  $$ with u as (update public.live_state set poll_seconds = 300 returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'a club cannot change the poll interval');
select throws_ok($$ update public.live_state set changed_at = now() $$, '42501', null, 'a club cannot move changed_at itself');

select tests.authenticate_as(tests.fx('uo'), tests.fx('so2'), 'aal2');
insert into public.notices (title, body, ends_at) values ('Owner notice', 'Hello', now() + interval '1 day');
select tests.become_postgres();
select ok(tests.live_moved(), 'a notice moves changed_at');

select tests.rewind_live();
select tests.authenticate_as(tests.fx('uo'), tests.fx('so2'), 'aal2');
update public.site_settings set public_reads_enabled = false;
select tests.become_postgres();
select ok(tests.live_moved(), 'switching public reads moves changed_at');

select tests.authenticate_as(tests.fx('uo'), tests.fx('so2'), 'aal2');
select results_eq(
  $$ with u as (update public.live_state set poll_seconds = 120 returning 1) select count(*)::int from u $$,
  $$ values (1) $$, 'the owner at aal2 can change the poll interval');
select throws_ok($$ update public.live_state set poll_seconds = 5 $$, '23514', null, 'only the offered intervals are allowed');

select tests.become_postgres();
select is((select count(*)::int from audit.events where entity = 'live_state' and at = now()), 1,
  'interval changes are audited');

select * from finish();
rollback;
