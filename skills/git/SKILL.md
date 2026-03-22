---
name: git
description: "Git workflows, rebasing, conflict resolution, hooks, monorepo patterns, bisect, reflog, stash, worktrees, cherry-pick, signing, submodules, and advanced history rewriting."
domain: devops
version: "1.0"
---

# Git Reference Dictionary

## Branching Strategies

### Git Flow

```bash
# Main branches: main (production), develop (integration)
# Supporting: feature/*, release/*, hotfix/*

# Start a feature
git checkout develop
git checkout -b feature/user-auth

# Work on feature, then merge back
git checkout develop
git merge --no-ff feature/user-auth
git branch -d feature/user-auth

# Start a release
git checkout develop
git checkout -b release/1.2.0
# ... bump version, fix bugs ...
git checkout main
git merge --no-ff release/1.2.0
git tag -a v1.2.0 -m "Release 1.2.0"
git checkout develop
git merge --no-ff release/1.2.0
git branch -d release/1.2.0

# Hotfix from production
git checkout main
git checkout -b hotfix/fix-login
# ... fix the bug ...
git checkout main
git merge --no-ff hotfix/fix-login
git tag -a v1.2.1 -m "Hotfix 1.2.1"
git checkout develop
git merge --no-ff hotfix/fix-login
git branch -d hotfix/fix-login
```

### Trunk-Based Development

```bash
# Everyone works on main with short-lived feature branches
git checkout main
git pull --rebase origin main
git checkout -b feat/quick-change

# Work for a day or two maximum, then:
git checkout main
git pull --rebase origin main
git checkout feat/quick-change
git rebase main
# Resolve any conflicts, then:
git checkout main
git merge --ff-only feat/quick-change
git push origin main
git branch -d feat/quick-change

# Feature flags for incomplete work
# Deploy main continuously; toggle features with flags
# if (featureFlags.isEnabled('new-dashboard')) { ... }
```

### GitHub Flow

```bash
# Simple: main + feature branches + PRs
git checkout -b feature/add-search
# ... make commits ...
git push -u origin feature/add-search
# Open PR, get review, merge via GitHub UI

# Keep feature branch up to date with main
git fetch origin
git rebase origin/main
# Force push to update PR (only YOUR branch)
git push --force-with-lease
```

## Rebasing

### Interactive Rebase

```bash
# Rebase last 5 commits interactively
git rebase -i HEAD~5

# The editor shows:
# pick abc1234 Add user model
# pick def5678 Fix typo in user model
# pick ghi9012 Add user controller
# pick jkl3456 WIP: debugging
# pick mno7890 Add user routes

# Common operations:
# pick   = keep commit as-is
# reword = keep commit but edit message
# edit   = pause to amend the commit
# squash = meld into previous commit (keep message)
# fixup  = meld into previous commit (discard message)
# drop   = remove commit entirely

# Squash fixup commits:
# pick abc1234 Add user model
# fixup def5678 Fix typo in user model
# pick ghi9012 Add user controller
# drop jkl3456 WIP: debugging
# pick mno7890 Add user routes

# Reorder commits by moving lines around
# pick ghi9012 Add user controller
# pick abc1234 Add user model
# pick mno7890 Add user routes
```

### Rebase Onto

```bash
# Move a branch from one base to another
# Before: A-B-C (main) -> D-E (feature) -> F-G (sub-feature)
# Want sub-feature based on main instead of feature

git rebase --onto main feature sub-feature
# After: A-B-C (main) -> F'-G' (sub-feature)

# Rebase a range of commits
# Only replay commits D..G onto new-base
git rebase --onto new-base D G

# Remove a range of commits from history
# Remove commits C and D from: A-B-C-D-E-F
git rebase --onto B D HEAD
# Result: A-B-E'-F'
```

### Autosquash Workflow

```bash
# When you know a commit fixes a previous one:
git commit --fixup=abc1234
# Creates: "fixup! Original commit message"

# Or with a new message:
git commit --squash=abc1234
# Creates: "squash! Original commit message"

# Later, auto-arrange during rebase:
git rebase -i --autosquash main
# fixup/squash commits are auto-placed after their targets

# Enable autosquash by default:
git config --global rebase.autoSquash true
```

## Conflict Resolution

### Understanding Conflict Markers

```
<<<<<<< HEAD (Current Change)
const timeout = 5000;
||||||| merged common ancestors (with diff3)
const timeout = 3000;
=======
const timeout = 10000;
>>>>>>> feature/new-timeouts (Incoming Change)
```

### Conflict Resolution Strategies

```bash
# Enable diff3 for better conflict context (shows common ancestor)
git config --global merge.conflictStyle diff3

# Use a merge tool
git mergetool
# Configure: git config --global merge.tool vimdiff

# Accept all changes from one side
git checkout --ours path/to/file    # keep current branch version
git checkout --theirs path/to/file  # keep incoming branch version

# Accept ours/theirs for the entire merge
git merge -X ours feature-branch
git merge -X theirs feature-branch

# During rebase conflicts
git rebase main
# ... resolve conflicts in files ...
git add resolved-file.txt
git rebase --continue
# To abort the whole rebase:
git rebase --abort
# To skip the problematic commit:
git rebase --skip

# Rerere: Reuse Recorded Resolution
git config --global rerere.enabled true
# Git remembers how you resolved a conflict and auto-applies it next time
# Check recorded resolutions:
git rerere status
git rerere diff
# Forget a bad resolution:
git rerere forget path/to/file
```

### Complex Merge Scenarios

```bash
# Merge with manual resolution strategy
git merge --no-commit --no-ff feature-branch
# Inspect what's about to be committed
git diff --cached
# Make additional adjustments
git commit

# Octopus merge (merge multiple branches at once)
git merge feature-a feature-b feature-c

# Subtree merge
git merge -s subtree library-branch
```

## Git Hooks

### Client-Side Hooks

```bash
# .git/hooks/pre-commit (runs before commit is created)
#!/bin/sh
# Lint staged files only
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|ts|jsx|tsx)$')
if [ -n "$STAGED_FILES" ]; then
    npx eslint $STAGED_FILES || exit 1
fi

# Prevent commits with TODO/FIXME
if git diff --cached | grep -iE '^\+.*(TODO|FIXME|HACK|XXX)' > /dev/null; then
    echo "WARNING: You have TODO/FIXME markers in staged changes."
    echo "Use 'git commit --no-verify' to bypass."
    exit 1
fi

# Check for secrets/credentials
if git diff --cached | grep -iE '(password|secret|api_key|token)\s*=\s*["\x27][^"\x27]+' > /dev/null; then
    echo "ERROR: Possible credentials detected in staged changes!"
    exit 1
fi
```

```bash
# .git/hooks/commit-msg (validate commit message format)
#!/bin/sh
COMMIT_MSG_FILE=$1
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

# Enforce Conventional Commits
PATTERN='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?(!)?: .{1,72}'
if ! echo "$COMMIT_MSG" | head -1 | grep -qE "$PATTERN"; then
    echo "ERROR: Commit message must follow Conventional Commits format:"
    echo "  type(scope): description"
    echo "  e.g., feat(auth): add OAuth2 login flow"
    exit 1
fi
```

```bash
# .git/hooks/pre-push (runs before push)
#!/bin/sh
REMOTE="$1"
URL="$2"

# Prevent force push to main/master
while read local_ref local_sha remote_ref remote_sha; do
    if echo "$remote_ref" | grep -qE 'refs/heads/(main|master)'; then
        FORCE_PUSH=$(git rev-list "$remote_sha".."$local_sha" 2>/dev/null | wc -l)
        MISSING=$(git rev-list "$local_sha".."$remote_sha" 2>/dev/null | wc -l)
        if [ "$MISSING" -gt 0 ]; then
            echo "ERROR: Force push to $remote_ref is not allowed!"
            exit 1
        fi
    fi
done

# Run tests before pushing
npm test || exit 1
```

### Husky + lint-staged (Node.js Projects)

```json
// package.json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{js,ts,jsx,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml}": ["prettier --write"],
    "*.py": ["black", "ruff check --fix"]
  }
}
```

```bash
# Setup
npm install --save-dev husky lint-staged
npx husky init
echo "npx lint-staged" > .husky/pre-commit
```

### Server-Side Hooks

```bash
# hooks/pre-receive (on the server, gate pushes)
#!/bin/sh
while read oldrev newrev refname; do
    # Reject large files
    git rev-list "$oldrev".."$newrev" | while read rev; do
        git diff-tree -r --diff-filter=ACM "$rev" | while read mode_old mode_new sha_old sha_new status path; do
            size=$(git cat-file -s "$sha_new")
            if [ "$size" -gt 10485760 ]; then  # 10MB
                echo "ERROR: File $path ($size bytes) exceeds 10MB limit"
                exit 1
            fi
        done
    done
done
```

## Monorepo Patterns

### Sparse Checkout

```bash
# Clone only specific directories from a large monorepo
git clone --filter=blob:none --sparse https://github.com/org/monorepo.git
cd monorepo
git sparse-checkout init --cone
git sparse-checkout set packages/my-app packages/shared-lib

# Add more paths later
git sparse-checkout add packages/another-app

# List current sparse paths
git sparse-checkout list

# Disable sparse checkout (get everything)
git sparse-checkout disable
```

### Partial Clone

```bash
# Blobless clone: fetch tree structure but not file contents
git clone --filter=blob:none https://github.com/org/monorepo.git

# Treeless clone: even more minimal, no tree objects
git clone --filter=tree:0 https://github.com/org/monorepo.git

# Fetch blobs on demand when you checkout files
# Git handles this automatically

# Combine with sparse checkout for fastest clone
git clone --filter=blob:none --sparse https://github.com/org/monorepo.git
```

### Path-Scoped Operations

```bash
# Log changes only in a subdirectory
git log --oneline -- packages/auth/
git log --oneline --follow -- src/utils/helper.ts  # track renames

# Diff only specific paths
git diff main -- packages/api/ packages/shared/

# Blame with path
git blame packages/api/src/routes.ts

# Find which commits touched a directory
git log --all --oneline -- packages/billing/

# Checkout a file from another branch
git checkout feature-branch -- packages/shared/types.ts
```

## Git Bisect

### Basic Bisect

```bash
# Find the commit that introduced a bug
git bisect start

# Mark current state as bad
git bisect bad

# Mark a known good commit
git bisect good v1.0.0
# or: git bisect good abc1234

# Git checks out a middle commit. Test it, then:
git bisect good   # if the bug is NOT present
# or
git bisect bad    # if the bug IS present

# Git narrows down and checks out another commit...
# Repeat until it finds the first bad commit

# When done:
git bisect reset
```

### Automated Bisect

```bash
# Automate with a test script
git bisect start HEAD v1.0.0
git bisect run npm test
# Git automatically marks good/bad based on exit code (0 = good, 1 = bad)

# With a custom script
git bisect run ./test-specific-bug.sh

# Skip untestable commits (e.g., won't compile)
git bisect skip

# Bisect with a range
git bisect start HEAD~50 HEAD~200

# View bisect log
git bisect log

# Replay a bisect session
git bisect log > bisect-log.txt
git bisect replay bisect-log.txt
```

### Bisect with Script

```bash
#!/bin/bash
# test-specific-bug.sh
# Exit 0 = good, exit 1 = bad, exit 125 = skip (can't test)

# Check if it compiles first
make build 2>/dev/null || exit 125

# Run specific test
if python -c "from myapp import parser; assert parser.parse('edge-case') == expected"; then
    exit 0  # good
else
    exit 1  # bad
fi
```

## Reflog

### Recovery Patterns

```bash
# View reflog (log of all HEAD movements)
git reflog
# Output like:
# abc1234 HEAD@{0}: commit: Add feature
# def5678 HEAD@{1}: rebase: fast-forward
# ghi9012 HEAD@{2}: checkout: moving from main to feature

# Recover after a bad rebase
git reflog
# Find the commit before the rebase started
git reset --hard HEAD@{5}

# Recover a deleted branch
git reflog
# Find the last commit on the deleted branch
git checkout -b recovered-branch abc1234

# Recover after git reset --hard
git reflog
git reset --hard HEAD@{2}

# View reflog for a specific branch
git reflog show feature-branch

# Reflog entries expire (default 90 days for reachable, 30 for unreachable)
# Extend expiration:
git config gc.reflogExpire 180.days
git config gc.reflogExpireUnreachable 90.days

# Reflog with dates
git reflog --date=relative
git reflog --date=iso
```

### Recovering Lost Commits

```bash
# Find dangling commits (not reachable from any ref)
git fsck --lost-found

# Find all commits by a pattern in their message
git log --all --oneline --grep="lost feature"

# Find commits not in any branch
git log --all --oneline --reflog | head -50

# Cherry-pick a recovered commit
git cherry-pick abc1234

# Inspect a dangling commit
git show abc1234
git log --oneline abc1234..HEAD
```

## Stash

### Basic Stash Operations

```bash
# Stash working directory changes
git stash
git stash push -m "work in progress on login"

# Stash specific files
git stash push -m "partial stash" -- src/auth.ts src/login.ts

# Stash including untracked files
git stash -u
git stash --include-untracked

# Stash everything including ignored files
git stash -a
git stash --all

# List stashes
git stash list
# stash@{0}: On feature: work in progress on login
# stash@{1}: WIP on main: abc1234 Fix typo

# Apply most recent stash (keep in stash list)
git stash apply

# Apply and remove from stash list
git stash pop

# Apply a specific stash
git stash apply stash@{2}
git stash pop stash@{1}

# Show stash contents
git stash show           # summary
git stash show -p        # full diff
git stash show stash@{1} -p

# Drop a stash
git stash drop stash@{1}

# Clear all stashes
git stash clear
```

### Advanced Stash

```bash
# Create a branch from a stash
git stash branch new-feature stash@{0}

# Stash only staged changes (keep unstaged in working tree)
git stash push --staged

# Stash only unstaged changes (keep staged)
git stash push --keep-index

# Interactive stash (choose which hunks to stash)
git stash push -p

# Apply stash to a different branch
git checkout other-branch
git stash apply stash@{0}
# Resolve conflicts if any
```

## Worktrees

### Managing Worktrees

```bash
# Create a new worktree for a branch
git worktree add ../project-hotfix hotfix/urgent-fix
# Creates ../project-hotfix with hotfix/urgent-fix checked out

# Create worktree with a new branch
git worktree add -b feature/new-thing ../project-feature main
# Creates new branch feature/new-thing from main

# List all worktrees
git worktree list
# /home/user/project        abc1234 [main]
# /home/user/project-hotfix def5678 [hotfix/urgent-fix]

# Remove a worktree
git worktree remove ../project-hotfix

# Prune stale worktree metadata
git worktree prune

# Lock a worktree (prevent accidental removal)
git worktree lock ../project-hotfix
git worktree unlock ../project-hotfix
```

### Worktree Workflow Patterns

```bash
# Review a PR while keeping your work
git worktree add ../review-pr-42 origin/pr-42
cd ../review-pr-42
# Run tests, review code...
cd ../project
git worktree remove ../review-pr-42

# Run tests on a different branch without switching
git worktree add ../test-main main
cd ../test-main && npm test
cd ../project
git worktree remove ../test-main

# Compare behavior between branches
# Terminal 1: cd ../project (feature branch, port 3000)
# Terminal 2: cd ../project-main (main branch, port 3001)
git worktree add ../project-main main
```

## Cherry-Pick

### Basic Cherry-Pick

```bash
# Apply a specific commit to current branch
git cherry-pick abc1234

# Cherry-pick multiple commits
git cherry-pick abc1234 def5678 ghi9012

# Cherry-pick a range (exclusive start, inclusive end)
git cherry-pick abc1234..ghi9012

# Cherry-pick without committing (stage changes only)
git cherry-pick --no-commit abc1234
# Useful for combining multiple cherry-picks into one commit

# Cherry-pick with a reference to the original commit
git cherry-pick -x abc1234
# Adds "(cherry picked from commit abc1234)" to the message

# Cherry-pick a merge commit (must specify parent)
git cherry-pick -m 1 merge-commit-sha
# -m 1 = mainline parent (the branch you merged INTO)
# -m 2 = the branch that was merged
```

### Cherry-Pick Conflict Resolution

```bash
# When cherry-pick has conflicts:
git cherry-pick abc1234
# CONFLICT in file.txt
# Edit file.txt to resolve

git add file.txt
git cherry-pick --continue

# Abort the cherry-pick
git cherry-pick --abort

# Skip this commit and continue with the rest
git cherry-pick --skip

# Cherry-pick with strategy
git cherry-pick -X theirs abc1234
```

## Signing Commits

### GPG Signing

```bash
# Generate a GPG key
gpg --full-generate-key
# Choose RSA and RSA, 4096 bits

# List GPG keys
gpg --list-secret-keys --keyid-format=long
# sec   rsa4096/ABC123DEF456 2024-01-01
#       Key fingerprint = ABCD 1234 ...
# uid         [ultimate] Name <email@example.com>

# Configure Git to use your key
git config --global user.signingkey ABC123DEF456
git config --global commit.gpgsign true
git config --global tag.gpgSign true

# Sign a single commit
git commit -S -m "Signed commit"

# Sign a tag
git tag -s v1.0.0 -m "Signed tag"

# Verify a commit signature
git verify-commit abc1234
git log --show-signature -1

# Verify a tag signature
git verify-tag v1.0.0

# Export public key (for GitHub/GitLab)
gpg --armor --export email@example.com
```

### SSH Signing (Git 2.34+)

```bash
# Configure SSH signing
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true

# Allowed signers file for verification
git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers

# Create allowed signers file
echo "email@example.com ssh-ed25519 AAAA..." > ~/.config/git/allowed_signers

# Verify
git verify-commit HEAD
```

## History Rewriting

### Amend and Rewrite

```bash
# Amend the last commit (message and/or content)
git commit --amend -m "Better message"
git add forgotten-file.txt && git commit --amend --no-edit

# Change author of last commit
git commit --amend --author="Name <email@example.com>"

# Change author of multiple commits
git rebase -i HEAD~5
# Mark commits with 'edit', then for each:
git commit --amend --author="Name <email@example.com>" --no-edit
git rebase --continue

# Remove a file from all history (e.g., accidentally committed secret)
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch path/to/secret.key' \
  --prune-empty --tag-name-filter cat -- --all

# Better: use git-filter-repo (faster, safer)
pip install git-filter-repo
git filter-repo --invert-paths --path secret.key
git filter-repo --path-rename old-dir/:new-dir/
```

### BFG Repo Cleaner

```bash
# Remove large files from history
java -jar bfg.jar --strip-blobs-bigger-than 10M repo.git

# Remove specific files
java -jar bfg.jar --delete-files '*.pem' repo.git

# Replace sensitive text
echo "REAL_PASSWORD==>REMOVED" > replacements.txt
java -jar bfg.jar --replace-text replacements.txt repo.git

# After BFG, always:
cd repo.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

## Advanced Log and Search

### Powerful Log Queries

```bash
# Search commit messages
git log --all --oneline --grep="fix login"
git log --all --oneline --grep="JIRA-1234"

# Search for code changes (pickaxe)
git log -S "functionName"          # commits that add/remove string
git log -G "regex_pattern"         # commits where diff matches regex
git log -S "className" --diff-filter=A  # only commits that ADD it

# Log with file diff stats
git log --stat
git log --shortstat --oneline
git log --numstat  # machine-readable

# Log with inline diff
git log -p -- path/to/file.ts

# Log graph
git log --oneline --graph --all --decorate
git log --oneline --graph --first-parent  # only merge commits

# Log between dates
git log --after="2024-01-01" --before="2024-06-01"
git log --since="2 weeks ago"

# Log by author
git log --author="John" --oneline
git log --author="john@example.com" --oneline

# Commits on branch-a but not on branch-b
git log branch-b..branch-a --oneline

# Show all merge commits
git log --merges --oneline
# Show all non-merge commits
git log --no-merges --oneline

# Find who last modified each line
git blame file.txt
git blame -L 10,20 file.txt          # specific lines
git blame -w file.txt                 # ignore whitespace
git blame --ignore-rev abc1234        # ignore a formatting commit
git blame --ignore-revs-file .git-blame-ignore-revs
```

### Diff Tricks

```bash
# Word-level diff
git diff --word-diff
git diff --word-diff=color

# Diff with function context
git diff -W  # show whole function

# Diff statistics
git diff --stat
git diff --shortstat
git diff --name-only
git diff --name-status  # shows A/M/D status

# Diff between branches
git diff main..feature --stat
git diff main...feature  # changes since branches diverged

# Diff specific file between commits
git diff abc1234..def5678 -- src/app.ts

# Diff with external tool
git difftool -t vimdiff

# Check if branches have diverged
git merge-base main feature
```

## Submodules

### Managing Submodules

```bash
# Add a submodule
git submodule add https://github.com/org/lib.git libs/lib
git submodule add -b main https://github.com/org/lib.git libs/lib

# Clone a repo with submodules
git clone --recurse-submodules https://github.com/org/project.git
# Or after cloning:
git submodule update --init --recursive

# Update submodules to latest remote commit
git submodule update --remote
git submodule update --remote --merge  # merge changes
git submodule update --remote --rebase # rebase changes

# Update a specific submodule
git submodule update --remote libs/lib

# Check submodule status
git submodule status

# Run a command in all submodules
git submodule foreach 'git checkout main && git pull'

# Remove a submodule
git submodule deinit libs/lib
git rm libs/lib
rm -rf .git/modules/libs/lib

# Change submodule URL
git config --file=.gitmodules submodule.libs/lib.url https://new-url.git
git submodule sync
git submodule update --init
```

## Configuration

### Essential Config

```bash
# Identity
git config --global user.name "Your Name"
git config --global user.email "you@example.com"

# Default branch name
git config --global init.defaultBranch main

# Pull strategy
git config --global pull.rebase true   # rebase instead of merge on pull
git config --global pull.ff only       # only fast-forward

# Push behavior
git config --global push.default current    # push current branch
git config --global push.autoSetupRemote true  # auto-set upstream

# Merge
git config --global merge.conflictStyle diff3  # show ancestor in conflicts
git config --global rerere.enabled true        # remember conflict resolutions

# Performance
git config --global core.fsmonitor true     # filesystem monitor
git config --global core.untrackedCache true
git config --global feature.manyFiles true  # optimize for large repos

# Aliases
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.st status
git config --global alias.lg "log --oneline --graph --all --decorate"
git config --global alias.undo "reset HEAD~1 --mixed"
git config --global alias.amend "commit --amend --no-edit"
git config --global alias.wip "commit -am 'WIP'"
git config --global alias.pushf "push --force-with-lease"
git config --global alias.cleanup "!git branch --merged | grep -v '\\*\\|main\\|master' | xargs git branch -d"
```

### Conditional Config

```bash
# ~/.gitconfig
[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-work
[includeIf "gitdir:~/personal/"]
    path = ~/.gitconfig-personal

# ~/.gitconfig-work
[user]
    email = you@company.com
    signingkey = WORK_KEY_ID

# ~/.gitconfig-personal
[user]
    email = you@personal.com
    signingkey = PERSONAL_KEY_ID
```

### Git Attributes

```bash
# .gitattributes

# Normalize line endings
* text=auto
*.sh text eol=lf
*.bat text eol=crlf

# Binary files
*.png binary
*.jpg binary
*.pdf binary
*.zip binary

# Custom diff for specific files
*.lockfile -diff
*.min.js -diff
*.csv diff=csv

# LFS tracking
*.psd filter=lfs diff=lfs merge=lfs -text
*.zip filter=lfs diff=lfs merge=lfs -text
*.mp4 filter=lfs diff=lfs merge=lfs -text

# Merge strategy for lock files
package-lock.json merge=ours
yarn.lock merge=ours

# Export ignore (for git archive)
.gitattributes export-ignore
.gitignore export-ignore
tests/ export-ignore
```

## Maintenance and Cleanup

### Repository Maintenance

```bash
# Garbage collection
git gc
git gc --aggressive --prune=now

# Check repository integrity
git fsck
git fsck --full --unreachable

# Find large objects in history
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  sed -n 's/^blob //p' | \
  sort -rnk2 | head -20

# Count objects
git count-objects -vH

# Prune remote tracking branches
git remote prune origin
git fetch --prune

# Delete merged branches
git branch --merged main | grep -v '^\*\|main\|master' | xargs git branch -d

# Delete remote merged branches
git branch -r --merged main | grep -v main | sed 's/origin\///' | xargs -I {} git push origin --delete {}

# Pack refs
git pack-refs --all

# Maintenance schedule (Git 2.29+)
git maintenance start
# Runs: gc, prefetch, commit-graph, loose-objects, incremental-repack
```

### .gitignore Patterns

```bash
# .gitignore

# Dependencies
node_modules/
vendor/
venv/
__pycache__/

# Build output
dist/
build/
*.o
*.pyc
*.class

# IDE
.idea/
.vscode/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Environment and secrets
.env
.env.*
!.env.example
*.pem
*.key
credentials.json

# Logs
*.log
logs/

# Testing
coverage/
.nyc_output/
htmlcov/

# Negation: track specific file within ignored directory
!.gitkeep

# Check what's being ignored and why
git check-ignore -v path/to/file
git status --ignored

# Global gitignore
git config --global core.excludesFile ~/.gitignore_global
```

## Patches and Bundles

### Creating and Applying Patches

```bash
# Create a patch from the last commit
git format-patch -1 HEAD
# Creates: 0001-commit-message.patch

# Create patches for a range
git format-patch main..feature
# Creates numbered patch files

# Create a single combined patch
git format-patch main..feature --stdout > feature.patch

# Apply a patch
git apply feature.patch          # apply without commit
git am 0001-commit-message.patch # apply as a commit
git am *.patch                   # apply all patches in order

# Check if a patch applies cleanly
git apply --check feature.patch

# Apply with 3-way merge (better conflict handling)
git am --3way 0001-commit-message.patch

# If am fails, resolve and continue
git am --continue
git am --abort
git am --skip
```

### Git Bundles

```bash
# Create a bundle (offline transfer)
git bundle create repo.bundle --all
git bundle create changes.bundle main..feature

# Verify a bundle
git bundle verify repo.bundle

# Clone from a bundle
git clone repo.bundle my-repo

# Fetch from a bundle
git fetch changes.bundle feature:feature

# Incremental bundles
git bundle create update.bundle --since=2024-01-01
```

## Common Pitfalls and Recovery

### Dangerous Commands and Safer Alternatives

```bash
# DANGEROUS: git push --force (can overwrite others' work)
# SAFER: git push --force-with-lease (fails if remote has new commits)
git push --force-with-lease

# DANGEROUS: git reset --hard (loses uncommitted changes)
# SAFER: Stash first
git stash
git reset --hard origin/main

# DANGEROUS: git clean -fd (deletes untracked files permanently)
# SAFER: Dry run first
git clean -fdn  # -n = dry run, shows what would be deleted
git clean -fd    # actually delete

# DANGEROUS: git checkout -- . (discards all unstaged changes)
# SAFER: Use restore with specific files
git restore src/specific-file.ts

# Recovery: Accidentally committed to wrong branch
git stash                        # save any uncommitted work
git log --oneline -3             # note the commit hash
git reset --soft HEAD~1          # undo commit, keep changes staged
git stash                        # stash the changes
git checkout correct-branch
git stash pop                    # apply changes
git commit -m "original message"

# Recovery: Undo a pushed commit (creates a revert commit)
git revert abc1234
git push

# Recovery: Undo multiple pushed commits
git revert --no-commit HEAD~3..HEAD
git commit -m "Revert last 3 commits"
```

### Debugging Git Issues

```bash
# Verbose output for operations
GIT_TRACE=1 git pull
GIT_CURL_VERBOSE=1 git fetch

# SSH debugging
GIT_SSH_COMMAND="ssh -vvv" git fetch

# Check remote URL
git remote -v
git remote show origin

# Verify connectivity
ssh -T git@github.com
ssh -T git@gitlab.com

# Fix "dubious ownership" error
git config --global --add safe.directory /path/to/repo

# Fix CRLF warnings
git config --global core.autocrlf input  # macOS/Linux
git config --global core.autocrlf true   # Windows

# Re-normalize line endings in repo
git add --renormalize .
```
