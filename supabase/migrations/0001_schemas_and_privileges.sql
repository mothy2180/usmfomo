-- 0001 — schemas and default privileges (deny by default).
--
-- public  : the only schema exposed to the Data API (config.toml [api].schemas)
-- private : account data and SECURITY DEFINER helpers; never exposed
-- audit   : append-only change log; never exposed
--
-- Nothing is reachable by anon/authenticated unless a later migration GRANTs it
-- explicitly. Never paste "GRANT ALL ... TO anon, authenticated".

create schema if not exists private;
create schema if not exists audit;

revoke all on schema private from public;
revoke all on schema audit from public;

-- RLS policies call a few private helpers as the signed-in user, which needs
-- USAGE on the schema plus EXECUTE on each helper (granted per function).
grant usage on schema private to authenticated;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and Supabase
-- adds default grants for the API roles. Revoke both for everything postgres
-- creates from now on; each function is then granted explicitly.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke execute on functions from public;
alter default privileges for role postgres in schema audit revoke execute on functions from public;

-- Value types shared by orgs and posts.
create type public.org_type as enum ('club', 'school');
create type public.campus as enum ('main', 'engineering', 'health', 'other', 'online');

comment on type public.org_type is
  'club = student-run bodies (clubs, societies, Desasiswa committees, MPP); school = academic and administrative units (schools, centres, institutes, HEPA units).';
