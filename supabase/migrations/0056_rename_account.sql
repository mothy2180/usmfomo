-- 0056 — the owner renames a club or school account's username.
--
-- A username is the login name: Auth signs in with the synthetic email
-- <username>@usmfomo.pages.dev, and private.accounts.username holds the same
-- name. owner-admin's rename_account (and the owner CLI's `rename`) first
-- changes the Auth email through the Admin API, then calls this function; if
-- it fails, they set the old email back. Clubs cannot rename themselves: there
-- is no grant, policy or Auth path for it (decision log, 2026-10-17).
--
-- Same rules as 0050: SECURITY DEFINER, empty search_path, service_role only.

-- Renames the account of p_user to p_username (normalised like account
-- creation). Refuses unknown users (account_not_found), the owner account
-- (account_is_owner) and a username another account has (username_taken; the
-- unique constraint also catches a race). The same name again changes nothing
-- and writes no audit row.
create function public.admin_rename_account(p_user uuid, p_username text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_new text := lower(btrim(p_username));
  v_old text;
  v_owner boolean;
  v_org uuid;
begin
  select a.username, a.is_owner, a.org_id into v_old, v_owner, v_org
  from private.accounts a
  where a.user_id = p_user
  for update;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0001';
  end if;
  if v_owner then
    raise exception 'account_is_owner' using errcode = 'P0001';
  end if;
  if v_new is not distinct from v_old then
    return;
  end if;
  if exists (select 1 from private.accounts a where a.username = v_new) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;

  -- A malformed name fails accounts_username_format (23514), a null one 23502.
  update private.accounts set username = v_new where user_id = p_user;
  perform private.audit('account_rename', 'account', p_user, v_org,
    jsonb_build_object('username', jsonb_build_array(v_old, v_new)));
end
$$;

revoke all on function public.admin_rename_account(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_rename_account(uuid, text) to service_role;
