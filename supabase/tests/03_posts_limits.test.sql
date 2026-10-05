-- Business rules enforced by Postgres: kill switch, date windows, quotas,
-- lifetime cap, storage paths and content CHECKs.
begin;
select plan(29);

-- Fixtures --------------------------------------------------------------------
insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'ub', tests.create_user('club-b');
insert into tests.fx (k, v) select 'ob', tests.create_org_account(tests.fx('ub'), 'club-b');
insert into tests.fx (k, v) select 'sb', tests.create_session(tests.fx('ub'));
insert into tests.fx (k, v) select 'uc', tests.create_user('club-c');
insert into tests.fx (k, v) select 'oc', tests.create_org_account(tests.fx('uc'), 'club-c');
insert into tests.fx (k, v) select 'sc', tests.create_session(tests.fx('uc'));
insert into tests.fx (k, v) select 'ud', tests.create_user('club-d');
insert into tests.fx (k, v) select 'od', tests.create_org_account(tests.fx('ud'), 'club-d');
insert into tests.fx (k, v) select 'sd', tests.create_session(tests.fx('ud'));

insert into tests.fx (k, v) select 'pa',
  tests.raw_post(tests.fx('oa'), now() + interval '1 day', now() + interval '1 day 2 hours');
insert into tests.fx (k, v) select 'pa_running',
  tests.raw_post(tests.fx('oa'), now() - interval '1 day', now() + interval '1 day');
insert into tests.fx (k, v) select 'pd',
  tests.raw_post(tests.fx('od'), now() + interval '3 days', now() + interval '3 days 2 hours');

-- B: 15 live posts already (cap) plus one expired post.
select tests.raw_post(tests.fx('ob'), now() + (n || ' days')::interval, now() + (n || ' days 1 hour')::interval)
from generate_series(1, 15) n;
insert into tests.fx (k, v) select 'pb_old',
  tests.raw_post(tests.fx('ob'), now() - interval '3 hours', now() - interval '2 hours');
insert into tests.fx (k, v) select 'pb_live', id from public.posts
  where org_id = tests.fx('ob') and ends_at > now() order by starts_at limit 1;

-- C: 5 new posts in the last 24 h (daily limit), well under the live cap.
select tests.raw_post(tests.fx('oc'), now() + (n || ' days')::interval, now() + (n || ' days 1 hour')::interval)
from generate_series(1, 5) n;

-- Kill switch -------------------------------------------------------------------
update public.site_settings set posting_enabled = false;
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Paused', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  'P0001', 'posting_paused', 'no new posts while posting is paused');
select throws_ok(
  $$ update public.posts set title = 'Paused edit' where id = tests.fx('pa') $$,
  'P0001', 'posting_paused', 'no edits while posting is paused');
select tests.become_postgres();
update public.site_settings set posting_enabled = true;

-- Date windows ------------------------------------------------------------------
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Almost over', 'Room', now() - interval '1 hour', now() + interval '10 minutes') $$,
  'P0001', 'end_in_past', 'a new post needs at least 15 minutes left');
select lives_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Already running', 'Room', now() - interval '1 hour', now() + interval '2 hours') $$,
  'an event already in progress can still be posted');
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Far future', 'Room', now() + interval '366 days', now() + interval '366 days 1 hour') $$,
  'P0001', 'start_too_late', 'no posts more than 365 days ahead');
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Too long', 'Room', now() + interval '1 day', now() + interval '33 days') $$,
  '23514', null, 'an event can last at most 31 days');
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Backwards', 'Room', now() + interval '2 days', now() + interval '1 day') $$,
  '23514', null, 'the end must be after the start');
select throws_ok(
  $$ update public.posts set starts_at = now() - interval '2 hours' where id = tests.fx('pa') $$,
  'P0001', 'start_too_early', 'an edit cannot move the start more than 1 hour into the past');
select throws_ok(
  $$ update public.posts set starts_at = now() - interval '30 minutes', ends_at = now() - interval '1 minute'
     where id = tests.fx('pa') $$,
  'P0001', 'end_in_past', 'an edit cannot move the end into the past');
select lives_ok(
  $$ update public.posts set venue = 'Hall B (moved)' where id = tests.fx('pa_running') $$,
  'a running multi-day event can still be edited when its dates do not change');
select isnt(
  (select details_changed_at from public.posts where id = tests.fx('pa_running')), null,
  'changing the venue sets details_changed_at');

-- Lifetime cap: a post can never end more than 400 days after it was created.
select tests.become_postgres();
select tests.raw_exec(format(
  'update public.posts set created_at = now() - interval %L where id = %L', '100 days', tests.fx('pa')));
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok(
  $$ update public.posts set starts_at = now() + interval '300 days', ends_at = now() + interval '301 days'
     where id = tests.fx('pa') $$,
  'P0001', 'too_long', 'no permanent adverts (400-day lifetime cap)');

-- Storage paths -----------------------------------------------------------------
select throws_ok(format(
  $f$ insert into public.posts (title, venue, starts_at, ends_at, poster_path, thumb_path)
      values ('Wrong folder', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour', %L, %L) $f$,
  tests.fx('ob') || '/' || gen_random_uuid() || '.webp', tests.fx('ob') || '/' || gen_random_uuid() || '-thumb.webp'),
  'P0001', 'path_invalid', 'a poster path must be in the club''s own folder');
select throws_ok(format(
  $f$ insert into public.posts (title, venue, starts_at, ends_at, poster_path, thumb_path)
      values ('Traversal', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour', %L, %L) $f$,
  tests.fx('oa') || '/../' || tests.fx('ob') || '/' || gen_random_uuid() || '.webp',
  tests.fx('oa') || '/' || gen_random_uuid() || '-thumb.webp'),
  'P0001', 'path_invalid', 'path traversal is rejected');
select throws_ok(format(
  $f$ insert into public.posts (title, venue, starts_at, ends_at, poster_path, thumb_path)
      values ('Only poster', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour', %L, null) $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '.webp'),
  '23514', null, 'poster and thumbnail come as a pair');
select lives_ok(format(
  $f$ insert into public.posts (title, venue, starts_at, ends_at, poster_path, thumb_path)
      values ('With poster', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour', %L, %L) $f$,
  tests.fx('oa') || '/' || gen_random_uuid() || '.webp', tests.fx('oa') || '/' || gen_random_uuid() || '-thumb.webp'),
  'a correct poster path is accepted');

-- Content CHECKs ----------------------------------------------------------------
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at, link_url)
     values ('Plain http', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour', 'http://forms.gle/x') $$,
  '23514', null, 'registration links must be https');
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at, link_url)
     values ('Userinfo', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour', 'https://usm.my@evil.example/login') $$,
  '23514', null, 'links with userinfo (user@host tricks) are rejected');
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at, link_url)
     values ('Spaces', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour', 'https://forms.gle/a b') $$,
  '23514', null, 'links with whitespace are rejected');
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values (E'Line\r\nATTACH:http://x', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  '23514', null, 'titles cannot contain control characters (calendar injection)');
select lives_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at, description, link_url)
     values ('Good post', 'Room', now() + interval '1 day', now() + interval '1 day 1 hour',
             E'Line one\nLine two', 'https://forms.gle/AbC123?x=1') $$,
  'descriptions may contain newlines and https links are accepted');

-- Live cap (B already has 15 live posts) ------------------------------------------
select tests.authenticate_as(tests.fx('ub'), tests.fx('sb'));
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Sixteenth', 'Room', now() + interval '20 days', now() + interval '20 days 1 hour') $$,
  'P0001', 'quota_live', 'at most 15 live posts per org');
select lives_ok(
  $$ update public.posts set ends_at = ends_at + interval '30 minutes' where id = tests.fx('pb_live') $$,
  'at the cap, a live post''s dates can still be adjusted');
select throws_ok(
  $$ update public.posts set starts_at = now() + interval '25 days', ends_at = now() + interval '25 days 1 hour'
     where id = tests.fx('pb_old') $$,
  'P0001', 'quota_live', 'reviving an expired post counts against the cap');

-- Daily limit (C already made 5 posts in the last 24 h) ----------------------------
select tests.authenticate_as(tests.fx('uc'), tests.fx('sc'));
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Sixth today', 'Room', now() + interval '9 days', now() + interval '9 days 1 hour') $$,
  'P0001', 'quota_daily', 'at most 5 new posts per 24 hours');
select lives_ok(
  $$ delete from public.posts where id = (select id from public.posts where org_id = tests.fx('oc') limit 1) $$,
  'a club can delete its own post');
select throws_ok(
  $$ insert into public.posts (title, venue, starts_at, ends_at)
     values ('Repost', 'Room', now() + interval '9 days', now() + interval '9 days 1 hour') $$,
  'P0001', 'quota_daily', 'deleting a post does not reset the daily limit');

-- Edit limit (30 per org per 24 h) -------------------------------------------------
select tests.authenticate_as(tests.fx('ud'), tests.fx('sd'));
select lives_ok(
  $$ do $d$ begin
       for i in 1..30 loop
         update public.posts set title = 'Edit number ' || i where id = tests.fx('pd');
       end loop;
     end $d$ $$,
  '30 edits in a day are allowed');
select throws_ok(
  $$ update public.posts set title = 'Edit 31' where id = tests.fx('pd') $$,
  'P0001', 'quota_edits', 'the 31st edit in 24 hours is refused');

select * from finish();
rollback;
