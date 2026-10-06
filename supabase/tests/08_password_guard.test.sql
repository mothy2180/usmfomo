-- Passwords change only against a one-time grant from the owner's tools (0052).
-- Auth (GoTrue) updates auth.users as supabase_auth_admin, which tests cannot
-- become; the same trigger fires for postgres here. The live check through
-- Auth itself is in scripts/lib/e2e/functions-e2e.ts.
begin;
select plan(25);

insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'ub', tests.create_user('club-b');
insert into tests.fx (k, v) select 'ob', tests.create_org_account(tests.fx('ub'), 'club-b');
insert into tests.fx (k, v) select 'uo', tests.create_user('owner');
select tests.create_owner(tests.fx('uo'));

-- The trigger ------------------------------------------------------------------------
select has_trigger('auth', 'users', 'usmfomo_password_guard', 'auth.users has the password guard');
select trigger_is('auth', 'users', 'usmfomo_password_guard', 'private', 'password_change_guard',
  'the guard runs private.password_change_guard()');
select is(
  (select array[tgtype::int, cardinality(tgattr::int2[])] from pg_trigger
   where tgrelid = 'auth.users'::regclass and tgname = 'usmfomo_password_guard'),
  array[19, 0],
  'BEFORE UPDATE FOR EACH ROW with no column list (Auth may still change the column''s type)');

-- Updates that keep the hash: sign-in times, bans, metadata ----------------------------
select lives_ok(
  $$ update auth.users
        set last_sign_in_at = now(), banned_until = null, raw_user_meta_data = '{}',
            encrypted_password = encrypted_password
      where id = tests.fx('ua') $$,
  'updates that keep the hash need no grant, even when they set encrypted_password');

-- A new password without a grant: PUT /auth/v1/user ------------------------------------
select throws_ok(
  $$ update auth.users set encrypted_password = 'hash-a1' where id = tests.fx('ua') $$,
  'P0001', 'password_change_refused', 'a club cannot set a new password without a grant');
select throws_ok(
  $$ update auth.users set encrypted_password = 'hash-o1' where id = tests.fx('uo') $$,
  'P0001', 'password_change_refused', 'neither can the owner account (its break-glass is the CLI)');

-- The grant -----------------------------------------------------------------------------
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok($$ select public.admin_allow_password_change(tests.fx('ua')) $$, '42501', null,
  'a club cannot grant itself a password change');
select throws_ok(
  $$ insert into private.password_grants (user_id, expires_at) values (tests.fx('ua'), now() + interval '1 day') $$,
  '42501', null, 'a club cannot write a grant itself');
select tests.become_anon();
select throws_ok($$ select public.admin_allow_password_change(gen_random_uuid()) $$, '42501', null,
  'anon cannot grant a password change');

select tests.become_service();
select throws_ok($$ select public.admin_allow_password_change(gen_random_uuid()) $$, 'P0001', 'user_not_found',
  'a grant for an unknown user is refused');
select lives_ok($$ select public.admin_allow_password_change(tests.fx('ua')) $$,
  'the service role grants one password change');
select tests.become_postgres();
select is((select expires_at from private.password_grants where user_id = tests.fx('ua')), now() + interval '60 seconds',
  'the grant lasts 60 seconds');

select throws_ok(
  $$ update auth.users set encrypted_password = 'hash-b1' where id = tests.fx('ub') $$,
  'P0001', 'password_change_refused', 'a grant for one account does not let another account''s password through');
select lives_ok(
  $$ update auth.users set encrypted_password = 'hash-a1' where id = tests.fx('ua') $$,
  'with the grant the new password is stored (owner reset, handover, CLI)');
select is((select encrypted_password from auth.users where id = tests.fx('ua')), 'hash-a1', 'the stored hash is the new one');
select is((select count(*)::int from private.password_grants where user_id = tests.fx('ua')), 0, 'the grant is used up');
select throws_ok(
  $$ update auth.users set encrypted_password = 'hash-a2' where id = tests.fx('ua') $$,
  'P0001', 'password_change_refused', 'a used grant does not allow a second change');

insert into private.password_grants (user_id, expires_at) values (tests.fx('ua'), now() - interval '1 second');
select throws_ok(
  $$ update auth.users set encrypted_password = 'hash-a2' where id = tests.fx('ua') $$,
  'P0001', 'password_change_refused', 'an expired grant is refused');

-- Removing a password (Auth's soft delete) ------------------------------------------------
select lives_ok($$ update auth.users set encrypted_password = null where id = tests.fx('ub') $$,
  'removing a password needs no grant: it lets nobody in');

-- Auth's encryption at rest: re-encrypting at sign-in is not a new password ----------------
select tests.become_service();
select public.admin_allow_password_change(tests.fx('ub'));
select tests.become_postgres();
update auth.users set encrypted_password = '$2a$10$plainplainplainplainplainplainplainplainplainplainpla'
 where id = tests.fx('ub');
select lives_ok(
  $$ update auth.users
        set encrypted_password = '{"key_id":"k1","alg":"aes-gcm-hkdf","data":"AA==","nonce":"AAAAAAAAAAAAAAAA"}'
      where id = tests.fx('ub') $$,
  're-encrypting a plain hash at sign-in does not fail the sign-in');
select is((select encrypted_password from auth.users where id = tests.fx('ub')),
  '$2a$10$plainplainplainplainplainplainplainplainplainplainpla', '... and keeps the stored hash');

select tests.become_service();
select public.admin_allow_password_change(tests.fx('ub'));
select tests.become_postgres();
update auth.users set encrypted_password = '{"key_id":"k1","alg":"aes-gcm-hkdf","data":"AQ==","nonce":"AAAAAAAAAAAAAAAA"}'
 where id = tests.fx('ub');
select throws_ok(
  $$ update auth.users
        set encrypted_password = '{"key_id":"k1","alg":"aes-gcm-hkdf","data":"Ag==","nonce":"AAAAAAAAAAAAAAAA"}'
      where id = tests.fx('ub') $$,
  'P0001', 'password_change_refused', 'a new password encrypted under the same key is refused');
select lives_ok(
  $$ update auth.users
        set encrypted_password = '{"key_id":"k2","alg":"aes-gcm-hkdf","data":"Aw==","nonce":"AAAAAAAAAAAAAAAA"}'
      where id = tests.fx('ub') $$,
  're-encrypting under a new key at sign-in does not fail the sign-in');
select is((select encrypted_password::jsonb ->> 'key_id' from auth.users where id = tests.fx('ub')), 'k1',
  '... and keeps the stored hash');

-- A deleted user's grant goes with it --------------------------------------------------------
select tests.become_service();
select public.admin_allow_password_change(tests.fx('ua'));
select tests.become_postgres();
delete from auth.users where id = tests.fx('ua');
select is((select count(*)::int from private.password_grants where user_id = tests.fx('ua')), 0,
  'deleting the user deletes its grant');

select * from finish();
rollback;
