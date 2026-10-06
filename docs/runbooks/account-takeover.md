# Account takeover

Someone who is not the club (or not you) is using an account: posts the club
did not make, a 2FA factor nobody recognises, a club saying "that wasn't us", or
logins at strange hours in the audit log. Contain first, investigate second.

## 1. Contain (minutes)

Owner console (or the owner CLI with the `owner-cli` key):

1. **Pause account** (Accounts → Manage): it can no longer sign in, and posting
   stops at once (`pnpm account deactivate <username>`).
2. **Reset the password**: this ends every session of the account
   (`pnpm account reset-password <username>`). Keep the new password to yourself
   for now.
3. **Remove all 2FA factors**: the attacker may have enrolled one
   (`pnpm account remove-factors <username>`).
4. **Moderation** → hide every bad post (or **Delete** / **Remove image**, which
   also deletes the files at once). Copies already cached can stay visible for
   up to 6 hours at the edge and 1 hour in browsers; there is no purge on the
   free plan.
5. Many accounts at once, or you are unsure how far it goes: **Overview** →
   **Kill switches** → **Pause posting** for everyone; public reading keeps
   working.

The order matters: banning and removing factors do not end live sessions; the
password reset does ([handover.md](handover.md)).

## 2. Investigate

The audit log records who changed what (changed columns only), with the session
id. Supabase dashboard → SQL editor (it runs as `postgres`; the table is not
exposed to the API):

```sql
select e.at, e.action, e.entity, e.entity_id, e.session_id, e.changes
from audit.events e
where e.org_id = (select id from public.orgs where slug = '<slug>')
  and e.at > now() - interval '14 days'
order by e.at desc
limit 200;
```

- Look for the first change the club does not recognise; note the session id
  and time.
- Authentication → Users → the account (`<username>@usmfomo.pages.dev`): last
  sign-in, enrolled factors and their creation dates.
- Ask the club through its **official channel** how the password could have
  leaked (shared in a group chat, a shared lab PC still signed in, a phone).

## 3. Recover

- When the legitimate committee is confirmed through the official channel, hand
  the account back with a fresh password and new factors: [handover.md](handover.md)
  (reactivate as its last step).
- Turn posting back on if you switched it off.
- Clean up: the club edits or deletes what remains; you delete what it cannot.

## 4. If the owner account may be compromised

Treat everything the owner can reach as exposed and rotate it all, from your laptop:

1. `pnpm account owner-reset-mfa <username>` (new owner password, every owner
   factor removed, every session ended), then enrol two new TOTP devices.
2. Replace the `owner-cli` secret key, and the `default` one too if any secret
   key could have leaked, in the order of [quota-attack.md](quota-attack.md),
   section 4: the new Edge Functions key must be named exactly `default`, then
   redeploy the functions.
3. New `CRON_SECRET` in both places, set together with `ADMIN_ORIGINS`
   ([deploy.md](deploy.md), "Rotating `CRON_SECRET`").
4. Renew the CI tokens (Supabase access token, Cloudflare API token) and update
   the GitHub environment secrets; review GitHub, Supabase and Cloudflare
   security logs for sessions you do not recognise.
5. Check every account's factor list for factors added recently.

## 5. Personal data and reporting

usmfomo holds very little personal data (usernames, posts, the audit log). If a
breach is likely to cause significant harm, the Malaysian PDPA timelines in
`SECURITY.md` apply: notify the Personal Data Protection Commissioner within
72 hours, then the affected individuals within 7 days of that notification.
Write down what happened, when, and what you did, as you go.

## 6. Afterwards

Add an entry to the journal in `docs/PROJECT.md` (what happened, the cause, what
changed), and fix the cause: for example tell clubs to sign out on shared PCs,
and push for 2FA with two devices.
