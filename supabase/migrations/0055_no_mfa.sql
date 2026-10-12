-- 0055 — No two-factor authentication.
--
-- The owner decided to drop TOTP for everyone (decision log, 2026-10-12): Auth
-- has TOTP enroll and verify switched off (config.toml), so no session can
-- reach aal2 and nothing may require it. What still guards writes: an active
-- account, an active org, a live session (session_live) and, for the owner,
-- the owner flag. Factors enrolled before this migration are simply ignored.

-- The caller's org, or NULL unless the account is active and not the owner,
-- the org is active and the session is live.
create or replace function private.my_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select a.org_id
  from private.accounts a
  join public.orgs o on o.id = a.org_id
  where a.user_id = (select auth.uid())
    and a.active
    and not a.is_owner
    and o.active
    and private.session_live();
$$;

-- Owner = owner account, active and a live session.
create or replace function private.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.session_live()
     and exists (
       select 1 from private.accounts a
       where a.user_id = (select auth.uid()) and a.is_owner and a.active
     );
$$;

-- No 'mfa_required' state and no 'factors' count any more.
create or replace function public.my_posting_status()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_acc record;
  v_new24 int;
begin
  if v_uid is null then
    return jsonb_build_object('state', 'anonymous');
  end if;

  select a.org_id, a.username, a.is_owner, a.active, o.name, o.slug, o.type, o.campus, o.active as org_active
    into v_acc
  from private.accounts a
  left join public.orgs o on o.id = a.org_id
  where a.user_id = v_uid;

  if not found then
    return jsonb_build_object('state', 'no_account');
  elsif v_acc.is_owner then
    return jsonb_build_object('state', 'owner', 'username', v_acc.username);
  elsif not v_acc.active or not v_acc.org_active then
    return jsonb_build_object('state', 'inactive', 'username', v_acc.username);
  elsif not private.session_live() then
    return jsonb_build_object('state', 'session_ended');
  end if;

  select count(*) into v_new24
  from private.post_log l
  where l.org_id = v_acc.org_id and l.created_at > now() - interval '24 hours';

  return jsonb_build_object(
    'state', 'ok',
    'username', v_acc.username,
    'org', jsonb_build_object('id', v_acc.org_id, 'name', v_acc.name, 'slug', v_acc.slug,
                              'type', v_acc.type, 'campus', v_acc.campus),
    'posting_enabled', (select s.posting_enabled from public.site_settings s where s.id = 1),
    'live', (select count(*) from public.posts p where p.org_id = v_acc.org_id and p.ends_at > now()),
    'live_limit', 15,
    'new_24h', v_new24,
    'new_limit', 5,
    'next_slot_at', case when v_new24 >= 5 then (
        select min(l.created_at) + interval '24 hours'
        from private.post_log l
        where l.org_id = v_acc.org_id and l.created_at > now() - interval '24 hours') end,
    'edits_24h', (select count(*) from audit.events e
                  where e.org_id = v_acc.org_id and e.action = 'post_update'
                    and e.at > now() - interval '24 hours'),
    'edits_limit', 30
  );
end
$$;

drop function private.mfa_satisfied();
