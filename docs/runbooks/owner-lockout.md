# Owner lockout (break-glass)

You cannot get into the owner console: the owner password is lost, or you
suspect someone else knows it. The owner CLI fixes this from your laptop with
the named secret key `owner_cli` (created in [deploy.md](deploy.md), step 2).
The owner account has no 2FA (removed for everyone, see the decision log in
[PROJECT.md](../PROJECT.md)), so a new password is all it takes.

## Before you start

- You need the `owner_cli` key from your password manager. It bypasses every
  database rule: use it in one command, typed or pasted into a hidden prompt,
  never exported, never saved to a file or shell history.
- Do this on your own Mac, on a network you trust.

## 1. Lost the owner password

```zsh
read -rs 'k?owner_cli key: '; echo
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k pnpm account reset-password <username>; unset k
```

`reset-password` works on the owner account too: it sets a **new owner
password**, which ends every owner session, so nobody holding the old password
or an old session can carry on. The new password is printed once: save it in
your password manager. Then sign in at <https://usmfomo-admin.pages.dev> with
it.

## 2. Lost the `owner_cli` key too

1. Sign in to the Supabase dashboard (your Supabase account has its own MFA and
   recovery codes).
2. Project Settings → API Keys → **delete the old `owner_cli` key**, then
   **create a new secret key** with the same name. Leave the key named
   `default` alone: the Edge Functions use it.
3. Continue with section 1.

If you cannot reach the Supabase dashboard either, use Supabase's account
recovery (your recovery codes); nothing in usmfomo can bypass that.

## 3. If the lockout was not an accident

A laptop or password manager compromised, or sign-ins you did not make: assume
someone else may have owner access and follow
[account-takeover.md](account-takeover.md) for the owner account (new password,
and rotate the `owner_cli` key).

## Prevention

- The owner password is a long random one (the CLI generates it) and lives only
  in your password manager, which has its own recovery set up. Never reuse it.
- The `owner_cli` key lives there too.
- Recovery codes for GitHub, Supabase, Cloudflare and the contact-channel Google
  account are saved there too.
