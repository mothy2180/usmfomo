# Onboard a club or school

A club or school asks for a posting account. Each one gets **one** account;
students never need one. Allow 15 minutes, plus a short call or meeting for the
first login.

## 1. Verify who is asking

- The request must come from, or be confirmed through, the organisation's
  **official channel**: its official email (for a school, a `usm.my` address of
  the office), its official Instagram/Facebook account, or the contact HEPA/MPP
  lists for it. A personal number or a forwarded screenshot alone is not enough.
- Ask for the name and role of the person who will receive the password, and
  confirm it through that official channel.
- Clubs are student-run bodies (clubs, societies, Desasiswa committees, MPP);
  schools are academic or administrative units (schools, centres, institutes,
  HEPA units). Check that the organisation does not already have an account:
  owner console → Accounts, or `pnpm account list`.

## 2. Choose the account details

| Field | Rule | Example |
|---|---|---|
| Username | 3–32 characters: lowercase letters, digits, `-`; starts and ends with a letter or digit | `robotics-club` |
| Organisation name | 2–100 characters, as students know it | `USM Robotics Club` |
| Slug | 1–50 characters, same character rules; becomes `usmfomo.pages.dev/o/<slug>` | `robotics-club` |
| Type | `club` or `school` | `club` |
| Campus | `main`, `engineering`, `health` or `other` | `main` |

Logins are usernames only; behind the scenes they become
`<username>@usmfomo.pages.dev`, and no email is ever sent.

## 3. Create the account

- Owner console (<https://usmfomo-admin.pages.dev>) → **Accounts** → **Create
  account**. The generated password (24 characters) is shown **once**.
- Or from your laptop, for production with the `owner-cli` key for this one command:

  ```zsh
  read -rs 'k?owner-cli key: '; echo
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=$k \
    pnpm account create robotics-club --org "USM Robotics Club" --type club --campus main --slug robotics-club
  unset k
  ```

## 4. Hand over the password 1:1

- Give it **only** to the verified person: in person, or in a direct message to
  the verified official account. **Never in a group chat**, a shared email
  thread or a document.
- Ask them to save it in a password manager straight away. usmfomo never stores
  it; if it is lost, the answer is a reset ([forgot-password.md](forgot-password.md)).
- Delete your copy of the message once they confirm they have it.

## 5. First login, together if you can

1. <https://usmfomo.pages.dev/login> → username, password, CAPTCHA.
2. Walk through the first-login checklist and the `/rules` page: what may be
   posted, and what the usmfomo admin may hide.
3. **2FA** (optional for clubs, strongly recommended): Studio → Settings → each
   committee member who will post enrols **their own** authenticator, all in
   **one sitting** from this first session. From then on every login needs a
   code. Keep at least two devices enrolled so one lost phone is not a lockout.
4. Post a test event together, then delete it.

Limits they will see in the status bar (the database enforces them):

- 15 live posts at a time; 5 new posts per 24 hours (deleting does not give one
  back); 30 edits per 24 hours.
- Events need a start and an end; a post disappears when its event ends.
- Posters: JPG, PNG or WebP up to 10 MB; the browser shrinks them (location data
  removed). At most 40 stored image files per organisation.

## 6. Keep a private record

In your own notes (not in the repo, not in a shared drive): organisation,
username, the verified contact channel, the date, and who received the password.
Nothing else about the person.

## Later

- New committee: [handover.md](handover.md). Forgotten password or lost phone:
  [forgot-password.md](forgot-password.md).
- Pause an account: console → Deactivate (or `pnpm account deactivate <username>`).
  It can no longer sign in or post; its existing posts stay up. To take the
  organisation's posts off the site too, edit the organisation and switch
  **Active** off. Both are reversible.
- Remove an organisation for good: console → Delete (or
  `pnpm account delete <username> --yes`). Its posters are deleted first, then
  the organisation and the login. Copies already cached can stay visible for up
  to 6 hours at the edge and 1 hour in browsers.
