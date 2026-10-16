-- The owner renames a club or school account's username (0056). The Auth email
-- changes through the Admin API first (owner-admin, owner CLI); the live check
-- through Auth itself is in scripts/lib/e2e/functions-e2e.ts.
begin;
select plan(19);

insert into tests.fx (k, v) select 'ua', tests.create_user('club-a');
insert into tests.fx (k, v) select 'oa', tests.create_org_account(tests.fx('ua'), 'club-a');
insert into tests.fx (k, v) select 'sa', tests.create_session(tests.fx('ua'));
insert into tests.fx (k, v) select 'ub', tests.create_user('club-b');
insert into tests.fx (k, v) select 'ob', tests.create_org_account(tests.fx('ub'), 'club-b');
insert into tests.fx (k, v) select 'uo', tests.create_user('pgtap-owner');
select tests.create_owner(tests.fx('uo'), 'pgtap-owner');
insert into tests.fx (k, v) select 'so', tests.create_session(tests.fx('uo'));

select function_privs_are('public', 'admin_rename_account', array['uuid', 'text'], 'service_role', array['EXECUTE'],
  'service_role can execute admin_rename_account');

-- Nobody but the service role --------------------------------------------------------
select tests.authenticate_as(tests.fx('ua'), tests.fx('sa'));
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), 'club-a2') $$, '42501', null,
  'a club cannot rename itself');
select tests.authenticate_as(tests.fx('uo'), tests.fx('so'));
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), 'club-a2') $$, '42501', null,
  'an owner session cannot call it directly either (owner-admin does, with the secret key)');
select tests.become_anon();
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), 'club-a2') $$, '42501', null,
  'anon cannot rename an account');
select tests.become_postgres();
select is((select username from private.accounts where user_id = tests.fx('ua')), 'club-a',
  '... and the username is unchanged');

-- Refusals ----------------------------------------------------------------------------
select tests.become_service();
select throws_ok($$ select public.admin_rename_account(gen_random_uuid(), 'club-x') $$, 'P0001', 'account_not_found',
  'an unknown user is refused');
select throws_ok($$ select public.admin_rename_account(tests.fx('uo'), 'new-owner') $$, 'P0001', 'account_is_owner',
  'the owner account is refused');
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), 'club-b') $$, 'P0001', 'username_taken',
  'a username another account has is refused');
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), ' Club-B ') $$, 'P0001', 'username_taken',
  '... also when it only differs in case and spaces');
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), 'pgtap-owner') $$, 'P0001', 'username_taken',
  '... and the owner''s username is taken too');
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), 'bad name') $$, '23514', null,
  'a malformed username fails accounts_username_format');
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), '-ab') $$, '23514', null,
  '... so does one starting with a hyphen');
select throws_ok($$ select public.admin_rename_account(tests.fx('ua'), null) $$, '23502', null,
  'a null username is refused');
select tests.become_postgres();
select is((select count(*)::int from audit.events where action = 'account_rename' and at = now()), 0,
  'refusals write no audit row');

-- The rename --------------------------------------------------------------------------
select tests.become_service();
select lives_ok($$ select public.admin_rename_account(tests.fx('ua'), ' Robotics-Club ') $$,
  'the service role renames a club account');
select tests.become_postgres();
select is((select username from private.accounts where user_id = tests.fx('ua')), 'robotics-club',
  'the new username is stored normalised (trimmed, lower case)');
select is(
  (select jsonb_build_object('entity', entity, 'entity_id', entity_id, 'org_id', org_id, 'changes', changes)
   from audit.events where action = 'account_rename' and at = now()),
  jsonb_build_object('entity', 'account', 'entity_id', tests.fx('ua'), 'org_id', tests.fx('oa'),
                     'changes', '{"username": ["club-a", "robotics-club"]}'::jsonb),
  'the rename is audited with the old and the new username');

select tests.become_service();
select lives_ok($$ select public.admin_rename_account(tests.fx('ua'), 'robotics-club') $$,
  'renaming to the current username succeeds');
select tests.become_postgres();
select is((select count(*)::int from audit.events where action = 'account_rename' and at = now()), 1,
  '... changes nothing and writes no second audit row');

select * from finish();
rollback;
