# Git Rules

分支: `feat/*` | `fix/*` | `docs/*` | `refactor/*` → main
Commit: `<type>: <subject>` (feat/fix/docs/refactor/test/chore)

Claude 禁止: git add | commit | push | stash | reset --hard | rebase
Claude 允許: git status | diff | log | branch | rev-parse

禁止事項: 直接 push 到 main | Force push 到共享分支 | Commit 包含 secrets
PR 流程: 開發 → /codex-review-fast → /precommit → /pr-review → PR
