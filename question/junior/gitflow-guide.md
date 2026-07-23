# Standard Gitflow — Real Case Guide

> Audience: a 2-year git user who wants to stop "just committing to main" and adopt a disciplined, team-friendly workflow.

---

## 1. The Mental Model

Gitflow defines **5 types of branches**, each with a clear purpose and lifetime.

| Branch        | Lifetime   | Branched from | Merged back to     | Purpose                                |
|---------------|------------|---------------|--------------------|----------------------------------------|
| `main`        | Forever    | —             | —                  | Production code. Every commit is a release. |
| `develop`     | Forever    | `main` (once) | —                  | Integration branch. Latest delivered dev changes. |
| `feature/*`   | Temporary  | `develop`     | `develop`          | New feature work.                      |
| `release/*`   | Temporary  | `develop`     | `main` + `develop` | Prep a production release (version bump, last bug fixes). |
| `hotfix/*`    | Temporary  | `main`        | `main` + `develop` | Emergency fix in production.           |

**Golden rule:** you never commit directly to `main` or `develop`. Always go through a branch + merge.

---

## 2. Visual Flow

```
main      ●─────────────●─────────────●────────────●  (v1.0)──(v1.1)──(v1.2)
           \           / \           / \          /
            \         /   \         /   \        /
release      \       ●─●─●/         \   ●─●─●  /  (release/1.1, release/1.2)
              \     /                \         /
develop        ●───●──────●───●───●───●───●───●
                          |   |       |
                       feature feature hotfix
                       /login  /cart   ●──● (hotfix/payment-bug)
```

---

## 3. Real Case Example: "ShopApp" Team

You're a backend dev on **ShopApp**. Current sprint goals:
- Build a **login** feature.
- Build a **cart** feature.
- Prep release **v1.2.0**.
- Mid-sprint, production has a **payment bug** that needs an emergency fix.

Let's walk through it.

### 3.1 First-time setup (only once per repo)

```bash
# Clone the repo
git clone git@github.com:twendee/shopapp.git
cd shopapp

# Create develop branch from main (only the first person does this)
git checkout main
git pull origin main
git checkout -b develop
git push -u origin develop
```

**Commands explained:**
- `git checkout -b develop` — create a new branch named `develop` AND switch to it. Equivalent to `git branch develop && git checkout develop`.
- `git push -u origin develop` — push and set `origin/develop` as the upstream. After this, plain `git push` and `git pull` know where to go.

---

### 3.2 Starting a feature: `feature/login`

You pick up the login ticket (e.g. JIRA-101).

```bash
# Always start from the latest develop
git checkout develop
git pull origin develop

# Create your feature branch
git checkout -b feature/JIRA-101-login

# ... write code, then:
git status                          # see what changed
git diff                            # see line-by-line changes
git add src/auth/login.service.ts   # stage specific files (NOT git add .)
git commit -m "feat(auth): add login service with JWT"
```

**Why `git add <file>` instead of `git add .`?**
`git add .` will accidentally include `.env`, generated files, debug logs, or unfinished work in other folders. Staging specific files forces you to review what you're committing.

**Commit message style** (Conventional Commits):
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code change with no behavior change
- `test:` — adding tests
- `docs:` — documentation
- `chore:` — tooling, deps, configs

### 3.3 Keeping your feature branch up to date

While you're working on login, a teammate merged the cart feature into `develop`. You should sync:

```bash
git checkout develop
git pull origin develop
git checkout feature/JIRA-101-login
git rebase develop
```

**`git rebase develop` explained:**
It takes your branch's commits, "lifts them off," moves your branch tip to the latest `develop`, then **replays your commits on top**. Result: clean, linear history.

**Alternative: `git merge develop` into your feature branch.** It works too, but creates an extra "merge commit" and a tangled history. Most teams prefer rebase for feature branches.

> ⚠️ **Rebase rule:** Only rebase branches **you alone work on**. Never rebase a branch others have pulled — it rewrites history and breaks their copy.

### 3.4 Pushing your work

```bash
git push -u origin feature/JIRA-101-login
```

If you rebased after pushing, you'll need:

```bash
git push --force-with-lease
```

**`--force-with-lease` vs `--force`:**
- `--force` blindly overwrites the remote. If a teammate pushed to your branch (e.g. a review fix), their work is **gone**.
- `--force-with-lease` refuses to push if the remote moved since your last fetch — it protects against destroying others' commits.

**Always use `--force-with-lease`.** Never `--force`.

### 3.5 Opening a Pull Request

On GitHub/GitLab: open a PR from `feature/JIRA-101-login` → `develop`.

PR description should answer:
- **What** changed? (1 sentence)
- **Why?** (link the ticket)
- **How to test?** (bulleted steps)

After review approval, **squash and merge** into `develop` (or merge commit — team convention). Squash = all your messy WIP commits collapse into 1 clean commit.

### 3.6 Cleanup after merge

```bash
git checkout develop
git pull origin develop                    # pull the merged result
git branch -d feature/JIRA-101-login       # delete local branch
git push origin --delete feature/JIRA-101-login  # delete remote branch
```

`-d` (lowercase) = safe delete; refuses if branch is unmerged.
`-D` (uppercase) = force delete. Use only when you're sure you want to throw away work.

---

### 3.7 Preparing a release: `release/1.2.0`

`develop` now has login + cart + a few smaller features. Time to ship.

```bash
git checkout develop
git pull origin develop
git checkout -b release/1.2.0
git push -u origin release/1.2.0
```

On this branch:
- Bump version in `package.json` → `1.2.0`
- Update `CHANGELOG.md`
- Fix last-minute bugs found in QA (commits go here, NOT in `develop`)

**No new features go into a release branch.** Only stabilization.

When QA passes, merge into BOTH `main` and `develop`:

```bash
# Merge into main and tag
git checkout main
git pull origin main
git merge --no-ff release/1.2.0
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin main --tags

# Merge release fixes back into develop
git checkout develop
git pull origin develop
git merge --no-ff release/1.2.0
git push origin develop

# Delete release branch
git branch -d release/1.2.0
git push origin --delete release/1.2.0
```

**Commands explained:**
- `git merge --no-ff` — `--no-ff` = "no fast-forward." Forces a merge commit even when a fast-forward is possible. Why? It preserves a visible "this is where release/1.2.0 merged in" record in history. Without it, the merge becomes invisible.
- `git tag -a v1.2.0 -m "..."` — `-a` creates an **annotated** tag (has author, date, message). Always use `-a` for releases. Lightweight tags (no `-a`) are just pointers, fine for personal bookmarks but bad for releases.
- `git push origin main --tags` — pushes commits AND tags. Tags don't push automatically.

---

### 3.8 Emergency: `hotfix/payment-bug`

Production v1.2.0 is live. A payment crash is reported. You can't wait for the next release.

```bash
# Branch from MAIN (not develop — develop may have unreleased features)
git checkout main
git pull origin main
git checkout -b hotfix/payment-bug

# Fix it, commit
git add src/payment/charge.service.ts
git commit -m "fix(payment): handle null currency code"
git push -u origin hotfix/payment-bug
```

Open a PR → `main`. After merge:

```bash
# Merge into main, tag a patch release
git checkout main
git pull origin main
git tag -a v1.2.1 -m "Hotfix v1.2.1: payment crash"
git push origin main --tags

# CRITICAL: also merge into develop so the fix isn't lost in next release
git checkout develop
git pull origin develop
git merge --no-ff hotfix/payment-bug
git push origin develop

# Cleanup
git branch -d hotfix/payment-bug
git push origin --delete hotfix/payment-bug
```

**Why merge into both?** If you only merge into `main`, the next release from `develop` will silently re-introduce the bug. This is one of the most common gitflow mistakes.

---

## 4. Common Commands — Deeper Explanations

### `git fetch` vs `git pull`

- `git fetch` — downloads remote changes into `origin/branch` but **does not** touch your working branch. Lets you inspect first.
- `git pull` — `fetch` + `merge` (or `rebase`) in one step.

Safer habit: `git fetch`, then `git log HEAD..origin/develop` to see what's new, then `git merge` or `git rebase`.

### `git stash` — pause your work

You're mid-feature, but need to switch to fix something urgently:

```bash
git stash push -m "WIP login form validation"
# ... do other work, switch branches ...
git stash list                # see all stashes
git stash pop                 # apply most recent stash AND remove it
git stash apply stash@{1}     # apply a specific one, keep it in the list
```

### `git reset` — undo, three flavors

```bash
git reset --soft HEAD~1    # undo last commit, KEEP changes staged
git reset --mixed HEAD~1   # undo last commit, KEEP changes unstaged (default)
git reset --hard HEAD~1    # undo last commit, DISCARD changes (destructive!)
```

`HEAD~1` = "one commit before HEAD". `HEAD~3` = three back.

> ⚠️ Never `git reset --hard` on a branch you've already pushed and others have pulled.

### `git revert` — undo, safely

```bash
git revert <commit-hash>
```

Creates a **new commit** that undoes the changes of the target commit. Safe to use on shared branches (`main`, `develop`) — doesn't rewrite history.

**Rule of thumb:**
- Branch is private → `reset` is fine.
- Branch is shared → `revert`.

### `git cherry-pick` — copy one commit

```bash
git cherry-pick <commit-hash>
```

Takes a single commit from anywhere and applies it to your current branch. Useful when a fix on `develop` also needs to go into a `release/*` branch without merging everything else.

### `git log` — your history toolbox

```bash
git log --oneline --graph --decorate --all    # visual tree of all branches
git log --author="quy"                        # filter by author
git log -p src/auth/login.ts                  # show diff for every commit touching this file
git log --since="2 days ago"
```

### `git reflog` — the safety net

If you mess up — wrong reset, lost branch, deleted commits — `git reflog` shows every HEAD movement for the last ~90 days:

```bash
git reflog
# e.g. shows: a1b2c3 HEAD@{2}: reset: moving to HEAD~3
git reset --hard a1b2c3   # back to before the mistake
```

Reflog has saved more careers than any backup system.

---

## 5. Where Your Current Flow Probably Goes Wrong

Common bad habits (and the fix):

| Bad habit                                              | Why it hurts                                        | Fix                                       |
|--------------------------------------------------------|-----------------------------------------------------|-------------------------------------------|
| Committing directly to `main`                          | No review, no rollback safety                       | Always branch + PR                        |
| `git add .` then `git commit -m "update"`              | Vague history, accidentally commits secrets         | Stage specific files, write meaningful messages |
| Long-lived feature branches (weeks)                    | Merge conflicts compound                            | Rebase on develop daily                   |
| Using `git pull` while having uncommitted changes      | Mysterious merge conflicts                          | Commit or stash first                     |
| `git push --force` to a shared branch                  | Destroys teammates' work                            | `--force-with-lease`, and only on your own branches |
| Forgetting to merge hotfix back into develop           | Bug returns in next release                         | Always merge hotfix → main AND develop    |
| One giant commit for a whole feature                   | Hard to review, hard to revert specific parts       | Small, logical commits                    |
| Mixing unrelated changes in one PR                     | Reviewers can't focus, harder to revert             | One PR = one purpose                      |

---

## 6. Daily Workflow Cheat Sheet

```bash
# Morning: sync up
git checkout develop
git pull origin develop

# Start a new task
git checkout -b feature/JIRA-XXX-short-description

# Work loop
git status
git diff
git add <specific-files>
git commit -m "feat(scope): clear description"

# Before pushing, sync with develop
git fetch origin
git rebase origin/develop          # if conflicts: fix, git add, git rebase --continue

# Push
git push -u origin feature/JIRA-XXX-short-description
# (after rebase on already-pushed branch:)
git push --force-with-lease

# Open PR → develop. After merge:
git checkout develop
git pull origin develop
git branch -d feature/JIRA-XXX-short-description
```

---

## 7. Quick Decision Tree

```
Need to do something? 
│
├─ New feature?            → branch from develop  → feature/*
├─ Prep a release?         → branch from develop  → release/*  → merge to main + develop
├─ Production is broken?   → branch from main     → hotfix/*   → merge to main + develop
└─ Experimenting?          → branch from develop  → feature/spike-* (probably delete later)
```

---

## 8. When NOT to use Gitflow

Gitflow is great for **versioned releases** (mobile apps, libraries, enterprise software).

For **continuous deployment** (web SaaS deploying many times per day), teams often use simpler flows:
- **GitHub Flow**: just `main` + short-lived feature branches. Deploy on every merge to main.
- **Trunk-Based Development**: everyone commits to `main` behind feature flags.

Pick the flow that matches your release cadence. Don't cargo-cult Gitflow just because it's "standard."


## Link: https://viblo.asia/p/tong-quan-ve-git-flow-va-cac-lenh-git-pho-bien-3RlL5ov84bB ( doc them bai nay)