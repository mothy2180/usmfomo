# Handover to a new committee

Use when a club's or school's office bearers change. The outgoing committee
must lose access completely, and the new one starts with its own password.

## Why the order matters

Banning an account does **not** end sessions that are already signed in; only a
**password reset** does (it revokes every session, and the database rejects
tokens of ended sessions at once). So always:

**deactivate → reset password → reactivate → the new committee signs in.**

## 1. Verify the new committee

- Confirm the change through the organisation's **official channel** (official
  email or social account, or the HEPA/MPP contact), not through the person who
  asks alone. For a disputed handover, wait until the organisation confirms in
  writing.
- Agree who receives the new password, and when you will both be online for the
  first login (step 3).

## 2. Run the handover

**Owner console** → Accounts → the organisation → **Hand over to a new
committee**. One click does, in this order: deactivate (and ban) → new password
(ends every session) → reactivate. The new password is shown **once**.

From your laptop instead (production: the `owner_cli` key for this command only):

```zsh
read -rs 'k?owner_cli key: '; echo
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k pnpm account handover <username>; unset k
```

If a step fails half-way, do the rest by hand **in the same order**:
`deactivate <username>` → `reset-password <username>` → `activate <username>`.

Check: the account list shows the account active.

## 3. First login of the new committee

1. Hand the password over **1:1** to the verified person (in person or a direct
   message to the official account); never in a group chat.
2. They sign in at <https://usmfomo.pages.dev/login> and save the password in
   a password manager.
3. They check that their upcoming posts are still there (posts survive a
   handover) and edit or delete what the old committee left behind.

## 4. Afterwards

- Note the date and the new contact in your private records.
- The old committee's devices and passwords are now useless; there is nothing
  for them to hand back.
- Posts or edits that nobody in the new committee recognises mean someone else
  has the password: treat it as [account-takeover.md](account-takeover.md).
