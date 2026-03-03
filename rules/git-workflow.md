# Git Rules

Branches: `feat/*` | `fix/*` | `docs/*` | `refactor/*` -> main
Commit: `<type>: <subject>` (feat/fix/docs/refactor/test/chore)

Claude forbidden: git add | commit | push | stash | reset --hard | rebase
Exception: `/push-ci` skill may execute `git push` after explicit user approval via AskUserQuestion
Exception: `/smart-commit --execute` may execute `git add` + `git commit` after explicit user approval via AskUserQuestion
Claude allowed: git status | diff | log | branch | rev-parse

Prohibited: Push directly to main | Force push to shared branches | Commit containing secrets
PR workflow: Develop -> /codex-review-fast -> /precommit -> /pr-review -> PR
