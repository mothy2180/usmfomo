# Handover to a new committee

Use when a club's or school's office bearers change. The outgoing committee
must lose access completely, and the new one starts with its own password and
its own 2FA devices.

## Why the order matters

Banning an account and deleting its 2FA factors do **not** end sessions that are
already signed in; only a **password reset** does (it revokes every session, and
the database rejects tokens of ended sessions at once). So always:

**deactivate → reset password → remove factors → reactivate → the new committee
enrols in one sitting.**

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
(ends every session) → delete every 2FA factor → reactivate. The new password
is shown **once**.

From your laptop instead (production: the `owner-cli` key for this command only):

```zsh
read -rs 'k?owner-cli key: '; echo
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k pnpm account handover <username>; unset k
```

If a step fails half-way, do the rest by hand **in the same order**:
`deactivate <username>` → `reset-password <username>` → `remove-factors <username>`
→ `activate <username>`.

Check: the account list shows the account active with **0 factors**.

## 3. First login of the new committee, in one sitting

1. Hand the password over **1:1** to the verified person (in person or a direct
   message to the official account); never in a group chat.
2. They sign in at <https://usmfomo.pages.dev/login>.
3. In the **same session**, each member who will post enrols their own
   authenticator (Studio → Settings → 2FA), one named factor per person; at
   least two in total. From then on every login needs a code.
4. They check that their upcoming posts are still there (posts survive a
   handover) and edit or delete what the old committee left behind.

## 4. Afterwards

- Note the date and the new contact in your private records.
- The old committee's devices and passwords are now useless; there is nothing
  for them to hand back.
- A newly enrolled factor that nobody in the new committee recognises means
  someone else has the password: treat it as [account-takeover.md](account-takeover.md).
