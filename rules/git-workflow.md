# Git Rules

Branches: `feat/*` | `fix/*` | `docs/*` | `refactor/*` -> main
Commit: `<type>: <subject>` (feat/fix/docs/refactor/test/chore)

Claude forbidden: git add | commit | push | stash | reset --hard | rebase
Exception: `/push-ci` skill may execute `git push` after explicit user approval via AskUserQuestion
Exception: `/smart-commit --execute` may execute `git add` + `git commit` after explicit user approval via AskUserQuestion
Claude allowed: git status | diff | log | branch | rev-parse

Prohibited: Push to protected branches without confirmation | Force push to shared branches | Commit containing secrets
Protected branches: main | master | develop | release/*
Push safety: Primary gate = `pre-push-gate.sh` (git hook, `/dev/tty` confirmation). Install via `/install-scripts`. AskUserQuestion in `/push-ci` is advisory only (session caching may auto-approve).
PR workflow: Develop -> /codex-review-fast -> /precommit -> /pr-review -> PR
