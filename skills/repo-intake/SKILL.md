---
name: repo-intake
description: "Project initialization inventory (one-time). Use when: first onboarding a project, rebuilding cache after structural changes. Not for: day-to-day development (read cache directly), finding specific files (use code-explore). Output: project map with entrypoints + test map + next steps."
allowed-tools: Bash(git:*), Bash(node:*), Read, Write, Grep, Glob
context: fork
agent: Explore
disable-model-invocation: true
---

# Repo Intake

## When to Use

- First time onboarding a project
- Rebuilding cache after major project structural changes
- Cache expired, needs updating

## When NOT to Use

- Already familiar with project structure (read cache directly)
- Only need to find specific files (use Glob/Grep)
- Day-to-day development (cache already exists)

## Workflow

```
Docs -> Entrypoints -> Tests Map -> Next Steps
```

## Usage

```bash
bash scripts/run-skill.sh repo-intake intake_cached.js --mode auto --top 10
```

## Manifest Map（宣告依賴地圖）

Monorepo / multi-package repo 的 workspace 拓撲與**宣告**依賴圖。邊語義是
`declares_dependency`——manifest 裡寫了什麼，不證明 import、呼叫或 runtime 影響。
一律 fail-closed：整份檔案無法讀取／UTF-8 解碼、或 JSON document 無法解析則記
coverage `skipped`；已進入 Go/TOML recognizer 的相關不支援 construct 則記
`partial`。絕不產生猜測邊。

```bash
bash scripts/run-skill.sh repo-intake manifest_map.js                      # overview (md)
bash scripts/run-skill.sh repo-intake manifest_map.js --format json        # 完整 envelope
bash scripts/run-skill.sh repo-intake manifest_map.js --reverse <selector> # 誰宣告依賴它
bash scripts/run-skill.sh repo-intake manifest_map.js --cycles             # 宣告環偵測
```

| Flag | 說明 |
|------|------|
| `--format md\|json` | 預設 `md`；json 為完整 artifact，不受 `--top` 截斷 |
| `--top N` | md 清單截斷（預設 12） |
| `--reverse <sel>` | selector：節點 ID（`ws:node:packages/a`）或名稱（`node:lodash` / `lodash`）；多重匹配 exit 2 並列出候選 |
| `--cycles` | 與 `--reverse` 互斥 |
| `--include-candidates` | 把未經 controller 確認的 candidate workspace 納入架構節點集（預設排除） |

生態系：node / php / go / rust / python（辨識 manifest 見
`scripts/config/repo-intake.json` 的 `manifest_map` 段）。無效參數 exit 2。
資料模型、解析矩陣與凍結語法契約：`references/manifest-map.md`；完整規格：
`docs/features/repo-intake-manifest-map/2-tech-spec.md`。

## Cache Location

Cache stored at: `~/.claude/cache/repo-intake/<repoKey>/`

| File          | Description             |
| ------------- | ----------------------- |
| `latest.md`   | Latest scan results     |
| `latest.json` | Latest scan results (JSON) |
| `LATEST.json` | Cache metadata          |

## Output

```markdown
## Overview

<summary>

## Entrypoints

- {CONFIG_FILE}
- {BOOTSTRAP_FILE}

## Test Map

| Type        | Pattern           |
| ----------- | ----------------- |
| Unit        | test/unit/        |
| Integration | test/integration/ |
| E2E         | test/e2e/         |

## Next Steps

- <questions>
```

## Verification

- Output includes Overview, Entrypoints, Test Map, Next Steps
- Entrypoints correctly identify `{CONFIG_FILE}`, `{BOOTSTRAP_FILE}`
- Test Map covers Unit/Integration/E2E layers

## References

- `references/manifest-map.md` — Manifest map 資料模型、解析矩陣、凍結契約摘要
- `references/archived/MIDWAY_HEURISTICS.md` — Legacy MidwayJS heuristics (archived, for reference only)

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/intake_cached.js` | Main intake with caching |
| `scripts/scan_repo.js` | Full repo scanner (framework-agnostic) |
| `scripts/scan_delta.js` | Delta scan for changed files |
| `scripts/manifest_map.js` | Workspace 拓撲 + 宣告依賴圖（overview / reverse / cycles） |

## Examples

```
Input: /repo-intake
Action: Execute intake script -> Output project map
```

```
Input: /repo-intake save
Action: Execute intake script -> Output and write to docs/ai/intake/
```
