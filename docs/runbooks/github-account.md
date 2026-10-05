# GitHub account guard — this repo lives under github.com/mothy2180 (personal)

This Mac's GitHub CLI and SSH key also hold a separate work account, and the
global git identity uses a work email. This repository is public, so neither the
work account name nor the work email may appear in its files **or in any commit
in its history**. The settings below pin **this repo only** to the personal
account; other projects keep working as before.

## 1. Personal account in the GitHub CLI (interactive — run it yourself)

New login (includes the permission needed to push workflow files):
```
gh auth login -h github.com -p https -w -s workflow
```
Already logged in without `workflow`:
```
gh auth switch -u mothy2180
gh auth refresh -h github.com -s workflow
```
**Before entering the one-time code in the browser, make sure the browser is
signed in to GitHub as mothy2180** (use a private window if the work account is
signed in). The code expires after about 15 minutes. `gh` keeps both accounts; if
you want the work account to stay the default for other projects, run
`gh auth switch` afterwards — this repo does not depend on which one is active.

## 2. Repo-local identity and credentials (already applied in this clone)

Re-run after a fresh clone:
```
git config --local user.name  "Timothy Thomas"
git config --local user.email "114565357+mothy2180@users.noreply.github.com"
git config --local credential.https://github.com.helper ""
git config --local --add credential.https://github.com.helper \
  '!f() { test "$1" = get || exit 0; echo username=mothy2180; echo "password=$(/opt/homebrew/bin/gh auth token --user mothy2180)"; }; f'
```
The empty helper clears the inherited helpers (macOS keychain and the global
`gh auth git-credential`); the second hands git the mothy2180 token on every push
from this repo, whatever account is active. The absolute path to `gh` keeps it
working from Git GUIs started from the Dock. The noreply address (`114565357` is
mothy2180's account id) attributes commits to mothy2180 without publishing an
email address. Never switch this repo to an SSH remote: the SSH key on this Mac
belongs to the work account.

## 3. Verify before any push

Keep the strings to search for **outside the repo**: put the work account name and
the work email's domain, one per line, in `~/.config/usmfomo/forbidden.txt`.
```
gh auth status                                                        # mothy2180 'Token scopes' include 'workflow'
GH_TOKEN="$(gh auth token --user mothy2180)" gh api user --jq .login  # must print mothy2180
git config user.email                                                 # must be the noreply address above
git log --all --format='%an <%ae> | %cn <%ce>' | sort -u              # noreply only
git log --all --format='%B' | grep -i -F -f ~/.config/usmfomo/forbidden.txt            # must print nothing
git grep -n -i -F -f ~/.config/usmfomo/forbidden.txt $(git rev-list --all) -- .        # must print nothing
```
If anything matches and nothing has been pushed yet, squash history into one root
commit (usmfomo never needed this: the identity was set before its first commit):
```
git checkout --orphan clean && git add -A && git commit -m "<message>" && git branch -M clean main
git reflog expire --expire=now --all && git gc --prune=now
```

## 4. Create the remote explicitly under the personal account

```
GH_TOKEN="$(gh auth token --user mothy2180)" gh repo create mothy2180/usmfomo --public --source . --remote origin --push
git remote -v          # https://github.com/mothy2180/usmfomo.git
```
If the repo was created but the push failed, do not re-run `gh repo create`; run
`git push -u origin main`.

## 5. Turn on the repository's security features

```
GH_TOKEN="$(gh auth token --user mothy2180)" gh api -X PUT repos/mothy2180/usmfomo/private-vulnerability-reporting
GH_TOKEN="$(gh auth token --user mothy2180)" gh api repos/mothy2180/usmfomo/private-vulnerability-reporting --jq .enabled   # true
GH_TOKEN="$(gh auth token --user mothy2180)" gh api repos/mothy2180/usmfomo --jq .security_and_analysis                     # secret scanning + push protection enabled
# Only if the line above shows secret_scanning or secret_scanning_push_protection as "disabled":
GH_TOKEN="$(gh auth token --user mothy2180)" gh api -X PATCH repos/mothy2180/usmfomo -f 'security_and_analysis[secret_scanning][status]=enabled' -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
GH_TOKEN="$(gh auth token --user mothy2180)" gh api -X PUT repos/mothy2180/usmfomo/vulnerability-alerts        # Dependabot alerts
GH_TOKEN="$(gh auth token --user mothy2180)" gh api -X PUT repos/mothy2180/usmfomo/automated-security-fixes    # Dependabot security updates
```
