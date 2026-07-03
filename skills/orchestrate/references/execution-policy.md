# Execution Policy（v1 report-only）

## Backend 選擇

| 條件 | Backend | 並行上限 |
|------|---------|---------|
| `Workflow` 工具可用且未指定 `--backend agent` | Dynamic Workflows（read-only fanout worker） | budget `max_workers` |
| 其餘 | background `Agent`（單訊息平行派發） | min(3, `max_workers`)——沿 deep-explore 既有模式 |

**Admission 與後端無關**：兩種 backend 用同一 `admission-allowlist.json`（deny-by-default）——避免「DW 不可用退回 Agent 時派出 mutating agent」。

## 波次與收斂（FR-5）

| 形狀 | 實作 |
|------|------|
| 循序 | `depends_on` 拓撲序執行 |
| 平行 | 同 `parallel_group` 單訊息派發；結果以 context packet 過濾彙整（傳事實不傳結論，沿 deep-explore 模式） |
| 收斂 | `converge.max_rounds`（≤ budget `max_waves`）；每輪後評 `done_criteria`，未滿足且有殘餘 round → 下一輪 |

## Fail-closed 矩陣

| 事件 | 處置 | run status |
|------|------|-----------|
| `plan-context.js` exit 1（缺檔/超量/allowlist 失效） | 停，回報原因 | （未建 run） |
| planning 後 compare drift | 停，不進 preview | `failed` |
| `validate-plan.js` 違規 | 帶規則代碼重規劃 ≤1 次；仍敗 → 停 | `needs_human` |
| 使用者拒絕 preview | 停（plan 留存於輸出供手動採用） | `aborted` |
| 高信度 secret 於意圖/完成定義 | 不落盤 run-state，提示改寫 | `needs_human` |
| worker 失敗 | 重規劃 ≤1 次（FR-9）；仍敗 → 停 | `needs_human` |
| execute 後 compare drift | 停，**不寫報告、不自動回復**（回復本身是 mutation） | `failed` |
| 報告 doc review 回 blocked/degraded/無法判定 | 停，報告不得視為完成交付 | `needs_human` |
| 報告 doc review 回 Mergeable | 完成 | `done` |
| `--resume` 時原 baseline compare drift | 停（中斷期間變化無法歸因；不得重拍 baseline） | `needs_human` |

## 觀測性（NFR-2）

每步執行時輸出一行操作狀態（step id + target + why 摘要）；run 結束輸出 `## Orchestrate Run Summary`（步驟 / 理由 / 證據 refs / 報告路徑）+ `[ORCHESTRATE_RUN] run_id=… status=…`。
