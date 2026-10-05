# Forgot password or lost 2FA device (club or school accounts)

usmfomo sends no email, so there is no "forgot password" link: the owner resets
it. A reset is exactly what an attacker would ask for, so **identity comes first**.

## 1. Verify identity before any reset

- The request must come through, or be confirmed by, the organisation's
  **official channel**: its official email (a `usm.my` office address for a
  school), its official Instagram/Facebook account, or the HEPA/MPP contact.
- A message from a personal number, a new account, or "I'm the new president,
  please hurry" is **not** enough on its own. Reply through the official channel
  and wait for the answer there.
- If the committee has changed, this is a handover, not a reset:
  [handover.md](handover.md).

## 2a. Forgotten password

Owner console → Accounts → the organisation → **Reset password**, or:

```zsh
read -rs 'k?owner-cli key: '; echo
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k pnpm account reset-password <username>; unset k
```

The new password (shown once) replaces the old one and **signs out every
session** of that account. Enrolled 2FA devices keep working.

## 2b. Lost 2FA device

After the identity check:

1. Owner console → **Remove 2FA factors** (or `pnpm account remove-factors <username>`).
   It removes every factor of the account.
2. **Then reset the password** as in 2a. Removing factors alone signs nobody
   out, and the missing phone may be in someone else's hands.
3. The committee enrols every member's device again in one sitting (step 3).

For a lost **owner** device, see [owner-lockout.md](owner-lockout.md).

## 3. Hand over 1:1, never in group chats

- Give the new password only to the verified person: in person, or a direct
  message to the verified official account. Never in a group chat, a shared
  email thread, a document or a screenshot.
- They save it in a password manager and, after a factor reset, enrol 2FA again
  in the same session (one device per member, at least two).
- Delete your copy of the message once they confirm.

## 4. Record it

Date, organisation, how identity was verified, who received the password. If
anything about the request felt wrong, also read [account-takeover.md](account-takeover.md).
