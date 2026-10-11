-- MyCSD: a yes/no flag set by the club (no by default), shown in the public lists.
begin;
select plan(5);

insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));

select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));

select lives_ok(
  $$ insert into public.posts (campus, title, venue, starts_at, ends_at, mycsd)
     values ('main', 'MyCSD talk', 'DK A', now() + interval '1 day', now() + interval '1 day 2 hours', true) $$,
  'a club can mark its event as counting for MyCSD');

select lives_ok(
  $$ insert into public.posts (campus, title, venue, starts_at, ends_at)
     values ('main', 'No MyCSD', 'DK B', now() + interval '2 days', now() + interval '2 days 2 hours') $$,
  'MyCSD can be left out');

select is((select mycsd from public.posts where title = 'No MyCSD'), false, 'MyCSD is no by default');

select lives_ok(
  $$ update public.posts set mycsd = false where title = 'MyCSD talk' $$,
  'a club can change MyCSD');

select tests.become_anon();
select is(
  (select s.mycsd from public.search_posts('club', 'No MyCSD') s),
  false,
  'the public list carries the MyCSD flag');

select * from finish();
rollback;
