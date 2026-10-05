-- Deny-by-default: what each API role can reach at all.
begin;
select plan(15);

select is(
  (select count(*)::int from pg_tables
   where schemaname in ('public', 'private', 'audit') and not rowsecurity),
  0, 'RLS is enabled on every table in public, private and audit');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema in ('private', 'audit') and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0, 'API roles have no table privileges in private or audit');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT'),
  0, 'anon has only SELECT on public tables');

select set_eq(
  $$ select table_name::text from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT' $$,
  array['notices', 'orgs', 'posts', 'site_settings'],
  'anon can SELECT exactly orgs, posts, notices and site_settings');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and privilege_type not in ('SELECT', 'DELETE')),
  0, 'authenticated has no table-wide INSERT/UPDATE (writes are column-scoped)');

select set_eq(
  $$ select table_name::text from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'DELETE' $$,
  array['notices', 'posts'],
  'authenticated can DELETE only on posts and notices (RLS decides which rows)');

select set_eq(
  $$ select column_name::text from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'posts'
       and grantee = 'authenticated' and privilege_type = 'INSERT' $$,
  array['campus', 'title', 'venue', 'description', 'link_url', 'starts_at', 'ends_at',
        'poster_path', 'thumb_path', 'cancelled_at'],
  'clubs cannot set org_id, hidden_at or timestamps on insert');

select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') $$,
  array['search_posts'],
  'anon can execute only search_posts in public');

select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['search_posts', 'my_posting_status'],
  'authenticated can execute only search_posts and my_posting_status in public');

select ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'maint\_%' or p.proname like 'admin\_%')) >= 15,
  'the maint_/admin_ RPCs exist');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'maint\_%' or p.proname like 'admin\_%')
     and not has_function_privilege('service_role', p.oid, 'execute')),
  0, 'service_role can execute every maint_/admin_ RPC');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('private', 'audit') and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon cannot execute any private or audit function');

select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['my_org_id', 'is_owner', 'mfa_satisfied', 'can_upload_poster'],
  'authenticated can execute only the policy helpers in private');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'audit') and p.prosecdef
     and not ('search_path=""' = any (coalesce(p.proconfig, '{}')))),
  0, 'every SECURITY DEFINER function pins an empty search_path');

select is(
  (select count(*)::int from pg_extension where extname = 'pg_graphql'),
  0, 'pg_graphql is not installed');

select * from finish();
rollback;
