-- 0052 — passwords change only through the owner's tools.
--
-- usmfomo has no self-service password change: the owner console's
-- reset_password and handover, and the owner CLI, set new passwords. But Auth
-- lets any signed-in user change their own password (PUT /auth/v1/user), and
-- that ends every other session. A committee member about to be replaced, or
-- anyone at a PC where a club is still signed in, could lock the committee out.
--
-- Auth makes the same UPDATE of auth.users for a user's own change and for an
-- admin reset, with the same database role, so the database cannot tell them
-- apart. Instead the owner tools first call admin_allow_password_change, a
-- service-only RPC that leaves a one-time grant, and the trigger below takes a
-- new password only against that grant. This covers the owner account too:
-- its break-glass is the CLI, which asks for a grant the same way.
--
-- The trigger fires on every UPDATE of auth.users (no column list) and checks
-- the hash itself: a trigger column list would block Auth's own migrations
-- from ever changing the type of encrypted_password.

create table private.password_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);
alter table private.password_grants enable row level security;

-- Lets the next password change of p_user through, once, within 60 seconds.
-- The caller sets the password right after (Auth Admin API).
create function public.admin_allow_password_change(p_user uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;
  insert into private.password_grants (user_id, expires_at)
  values (p_user, now() + interval '60 seconds')
  on conflict (user_id) do update set expires_at = excluded.expires_at;
end
$$;
revoke all on function public.admin_allow_password_change(uuid) from public, anon, authenticated;
grant execute on function public.admin_allow_password_change(uuid) to service_role;

-- The key id of a hash that Auth encrypted at rest (a JSON object such as
-- {"key_id": ..., "alg": "aes-gcm-hkdf", ...}), or null for a plain hash.
create function private.hash_key_id(p_hash text)
returns text
language sql stable set search_path = ''
as $$
  select case when left(p_hash, 1) = '{' and pg_input_is_valid(p_hash, 'jsonb')
              then nullif(p_hash::jsonb ->> 'key_id', '') end;
$$;
revoke all on function private.hash_key_id(text) from public, anon, authenticated;

create function private.password_change_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_granted boolean;
begin
  -- Sign-ins, bans and metadata changes keep the hash.
  if new.encrypted_password is not distinct from old.encrypted_password then
    return new;
  end if;

  -- A grant from admin_allow_password_change is used once.
  delete from private.password_grants g
   where g.user_id = new.id
  returning g.expires_at > now() into v_granted;
  if v_granted then
    return new;
  end if;

  -- Removing the password (Auth's soft delete) lets nobody in.
  if coalesce(new.encrypted_password, '') = '' then
    return new;
  end if;

  -- With its encryption at rest on, Auth re-encrypts the stored hash at
  -- sign-in (new key id, same password). Keep the stored hash, so sign-in
  -- goes on and nothing changes. A change that looks the same is dropped
  -- the same way; one under an unchanged key id is refused below.
  if private.hash_key_id(new.encrypted_password) is not null
     and private.hash_key_id(new.encrypted_password)
         is distinct from private.hash_key_id(old.encrypted_password) then
    new.encrypted_password := old.encrypted_password;
    return new;
  end if;

  raise exception 'password_change_refused' using errcode = 'P0001';
end
$$;
revoke all on function private.password_change_guard() from public, anon, authenticated;

create trigger usmfomo_password_guard
  before update on auth.users
  for each row execute function private.password_change_guard();
