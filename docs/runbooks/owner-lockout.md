# Owner lockout (break-glass)

You cannot get into the owner console: both TOTP devices are lost or reset, or
the owner password is gone. The owner CLI fixes this from your laptop with the
named secret key `owner-cli` (created in [deploy.md](deploy.md), step 2).

## Before you start

- You need the `owner-cli` key from your password manager. It bypasses every
  database rule: use it in one command, typed or pasted into a hidden prompt,
  never exported, never saved to a file or shell history.
- Do this on your own Mac, on a network you trust.

## 1. Lost both TOTP devices

```zsh
read -rs 'k?owner-cli key: '; echo
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k pnpm account owner-reset-mfa <username>; unset k
```

`owner-reset-mfa` first sets a **new owner password** (which ends every owner
session, so nobody holding the old password or an old session can enrol a
factor of their own), then removes every owner 2FA factor. The new password is
printed once: save it in your password manager. Then, straight away:

1. Sign in at <https://usmfomo-admin.pages.dev> with the new password; the
   console asks you to enrol 2FA before anything else.
2. Enrol **two** devices again (for example the replacement phone and a second
   device), in one sitting.
3. Check the account list: your owner account shows exactly the factors you just
   enrolled.

## 2. Lost the owner password

```zsh
read -rs 'k?owner-cli key: '; echo
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k pnpm account reset-password <username>; unset k
```

The new password is printed once: save it in your password manager. This also
signs out every owner session.

## 3. Lost the `owner-cli` key too

1. Sign in to the Supabase dashboard (your Supabase account has its own MFA and
   recovery codes).
2. Project Settings → API Keys → **delete the old `owner-cli` key**, then
   **create a new secret key** with the same name. Leave the key named
   `default` alone: the Edge Functions use it.
3. Continue with section 1 or 2.

If you cannot reach the Supabase dashboard either, use Supabase's account
recovery (your recovery codes); nothing in usmfomo can bypass that.

## 4. If the lockout was not an accident

A device stolen, or a factor you do not recognise: assume someone else may have
owner access and follow [account-takeover.md](account-takeover.md) for the owner
account (new password, new factors, and rotate the `owner-cli` key).

## Prevention

- Two enrolled TOTP devices at all times; replace a lost one the same day.
- The owner password and the `owner-cli` key live in your password manager,
  which has its own recovery set up.
- Recovery codes for GitHub, Supabase, Cloudflare and the contact-channel Google
  account are saved there too.
