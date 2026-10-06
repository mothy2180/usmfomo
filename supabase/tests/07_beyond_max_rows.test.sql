-- Lists longer than PostgREST's max_rows (100): accounts are paged in a total
-- order and found by direct lookups; the purge, the orphan sweep and an org's
-- file list come back whole as one jsonb value (0051).
begin;
select plan(17);

delete from public.posts;
delete from public.notices;

-- Two owner accounts (to show the user_id tiebreak) and 105 club accounts.
insert into tests.fx (k, v) select 'uo', tests.create_user('pgtap-owner');
select tests.create_owner(tests.fx('uo'), 'pgtap-owner');
insert into tests.fx (k, v) select 'uo2', tests.create_user('owner-two');
select tests.create_owner(tests.fx('uo2'), 'owner-two');
do $$
declare
  v_name text;
  v_user uuid;
begin
  for i in 1..105 loop
    v_name := format('bulk-%s', lpad(i::text, 3, '0'));
    v_user := tests.create_user(v_name);
    insert into tests.fx (k, v) values ('u' || i, v_user), ('o' || i, tests.create_org_account(v_user, v_name));
  end loop;
end
$$;

-- admin_list_accounts: pages ----------------------------------------------------------
select tests.become_service();
select is((select count(*)::int from public.admin_list_accounts()), 100,
  'one page holds at most 100 accounts');
select is((select count(*)::int from public.admin_list_accounts(1000)), 100,
  'p_limit cannot ask for more than 100 (PostgREST max_rows)');
select ok(not exists (select 1 from public.admin_list_accounts() where username = 'bulk-105'),
  'bulk-105 sorts past the first page');

select tests.become_postgres();
select is(
  (select count(distinct l.user_id)::int
   from generate_series(0, 4) g, lateral public.admin_list_accounts(100, g * 100) l),
  (select count(*)::int from private.accounts),
  'reading pages until a short one returns every account');
select results_eq(
  $$ select l.user_id
     from generate_series(0, 4) g, lateral public.admin_list_accounts(100, g * 100) with ordinality l
     order by g, l.ordinality $$,
  $$ select a.user_id from private.accounts a left join public.orgs o on o.id = a.org_id
     order by a.is_owner desc, o.name nulls first, a.user_id $$,
  'pages follow one total order: owners first, then organisation name, then user_id');
select is(
  array(select l.username from public.admin_list_accounts(2, 0) l),
  array(select a.username from private.accounts a where a.is_owner order by a.user_id limit 2),
  'owners (no organisation name) are ordered by user_id');

-- Direct lookups ---------------------------------------------------------------------
select tests.become_service();
select is(public.admin_get_account(tests.fx('u105')) ->> 'username', 'bulk-105',
  'admin_get_account finds an account past the first page');
select tests.become_postgres();
select is(
  public.admin_get_account(tests.fx('u105')),
  (select to_jsonb(l) from generate_series(0, 4) g, lateral public.admin_list_accounts(100, g * 100) l
   where l.user_id = tests.fx('u105')),
  'admin_get_account returns the same object as the account''s admin_list_accounts row');
select tests.become_service();
select is(public.admin_get_account_by_username(' BULK-105 ') ->> 'user_id', tests.fx('u105')::text,
  'admin_get_account_by_username normalises the name like account creation does');
select is(public.admin_get_account(gen_random_uuid()), null::jsonb,
  'admin_get_account: null when there is no account row');
select is(public.admin_get_account_by_username('nobody'), null::jsonb,
  'admin_get_account_by_username: null for an unknown name');
select ok(public.admin_get_account(null) is null and public.admin_get_account_by_username(null) is null,
  'a null argument finds nothing (never an arbitrary account)');

-- jsonb lists past 100 entries ----------------------------------------------------------
select tests.become_postgres();
do $$
begin
  for i in 1..105 loop
    perform tests.raw_object(tests.fx('o1') || '/' || gen_random_uuid() || '.webp', 1000, now() - interval '2 days');
  end loop;
  for i in 1..101 loop
    perform tests.raw_post(tests.fx('o2'), now() - interval '3 hours', now() - interval '2 hours', p_title => 'Old ' || i);
  end loop;
end
$$;
insert into public.notices (title, body, starts_at, ends_at)
select 'Old notice ' || i, 'x', now() - interval '2 days', now() - interval '1 day' from generate_series(1, 3) i;

select tests.become_service();
select is(jsonb_array_length(public.admin_org_objects(tests.fx('o1'))), 105,
  'admin_org_objects lists all 105 files of an org');
select is(jsonb_array_length(public.maint_orphans()), 105,
  'the orphan sweep returns all 105 orphans in one value');
select is(jsonb_array_length(public.maint_orphans(p_limit => 101)), 101,
  'the orphan sweep honours a p_limit above 100');
select results_eq(
  $$ select e ->> 'kind', count(*)::int from jsonb_array_elements(public.maint_purge_expired()) e group by 1 order by 1 $$,
  $$ values ('notice'::text, 3), ('post', 100) $$,
  'one purge returns 100 posts and 3 notices: 103 entries in one value');
select tests.become_postgres();
select is((select count(*)::int from public.posts where ends_at < now()), 1,
  'the 101st expired post waits for the next run');

select * from finish();
rollback;
