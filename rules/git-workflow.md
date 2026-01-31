# Git Rules

Branches: `feat/*` | `fix/*` | `docs/*` | `refactor/*` -> main
Commit: `<type>: <subject>` (feat/fix/docs/refactor/test/chore)

Claude forbidden: git add | commit | push | stash | reset --hard | rebase
Claude allowed: git status | diff | log | branch | rev-parse

Prohibited: Push directly to main | Force push to shared branches | Commit containing secrets
PR workflow: Develop -> /codex-review-fast -> /precommit -> /pr-review -> PR
