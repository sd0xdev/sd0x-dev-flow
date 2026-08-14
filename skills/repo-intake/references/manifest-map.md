# Manifest Map — 資料模型與解析契約摘要

操作型摘要，供讀取 `manifest_map.js` 輸出時查閱。完整規格（含凍結 EBNF、
go 複合宣告流程、registry 雙集合判定的推導）以
`docs/features/repo-intake-manifest-map/2-tech-spec.md` 為準；本檔與規格衝突時以規格為準。

## 邊語義（唯一一種）

`declares_dependency` — 來源 manifest 明確宣告了對目標的依賴。**不證明** import、
呼叫、build 順序或 runtime 影響。fail-closed 分三層：整份檔案無法讀取／UTF-8 解碼、
**JSON** document parse 失敗（package.json／composer.json），或超出單檔 byte 預算
→ coverage `skipped`（`unreadable` / `budget_exceeded`）；Go/TOML recognizer 是行導向
／區段導向，整體畸形文件仍回 ok——其中已辨識相關 construct 的畸形或不支援語法逐條
→ coverage `partial`；已解讀宣告但無法落邊 → `unresolvedDeclarations`（有明確落空
原因）。絕不出現猜測邊。

## JSON envelope

```
{ schemaVersion: 1,
  query: { kind: overview|reverse|cycles, selector?, results? },
  artifact: { generatedAt, root,
    workspaces[], controllers[], externals[], edges[],
    unresolvedDeclarations[], coverage[], omissions[], diagnostics[] } }
```

確定性：`artifact` 除 `generatedAt`/`root` 外逐欄位排序穩定，同一 corpus 兩次執行
byte-identical（測試 `test/skills/repo-intake/manifest-map.test.js` 釘住）。

## 節點 ID 與角色

| ID 形態 | 例 | 說明 |
|---------|-----|------|
| `ws:<eco>:<dir>` | `ws:node:packages/a` | 套件節點；root 目錄記為 `.` |
| `ext:<eco>:<name>` | `ext:rust:serde` | 外部依賴（已證明 corpus 內無合格候選；rust 例外見下） |
| `ctl:<type>:<dir>` | `ctl:go_work:.` | controller（go.work / pnpm-workspace.yaml / node workspaces / cargo workspace） |

角色：`standalone_root`（root 目錄套件）｜`confirmed_workspace`（任一 eligible
controller 確認成員）｜`candidate_workspace`（未確認；**預設排除**在架構節點集外，
`--include-candidates` 納入）。路徑含 `examples/ fixtures/ testdata/ samples/` 加旗標
`likely_fixture`。成員資格比對依 controller 分兩套規則：

- **node `workspaces` 與 Cargo `members`／`exclude`** 用凍結 glob 子集：字面路徑 +
  單一結尾 `*`；不支援的 include pattern → controller `partial`（已證明的確認仍成立）；
  不支援的 exclude pattern → 該 controller 整體 `unknown`（controller-local，不否決
  其他 controller 的確認——確認是單調的）。pnpm-workspace.yaml 一律 `unknown`
  （v1 不解析其 pattern）。
- **go.work `use`** 不經 glob matcher：operand 正規化後做**字面精確路徑**比對
  （`use .` 與 `../` 形式含在內）。凍結 operand 文法分兩種形式——bare：Unicode
  printable（L/M/N/P/S）正向表列，再**扣除**空白、引號（`"` `'` 反引號）、反斜線、
  `(){}[],` 與 `/*` 序列；quoted：非空、**不支援 escape**，允許 L/M/N/P/S＋ASCII
  空白。兩種形式共同邊界：非空、相對路徑限定（絕對路徑／磁碟機路徑 fail-closed）。
  glob **不展開**：含 `/*` 的未引號形式 fail-closed；單獨 `use *` 與引號中的 `"*"`
  都只是字面 operand（比對不到任何 `*/go.mod` 就不確認成員）；operand 脫出語料邊界
  → controller `partial`。

go.mod／go.work 一般 token（module／require／replace 全 token 位置）共用同一凍結
recognizer：裸 token 排除空白、引號、反斜線與 Go lexer 分隔符；引號形式解碼為裸值但
**不支援 escape**；非空＋Unicode printable 正向表列；子集外整筆 fail-closed（記
unsupported，零猜測邊）。

## 解析矩陣（辨識的 manifest 與欄位）

| 生態系 | Manifest | 依賴區段 → scope |
|--------|----------|------------------|
| node | `package.json` | dependencies=runtime, devDependencies=development, peerDependencies=peer, optionalDependencies=optional |
| php | `composer.json` | require=runtime, require-dev=development |
| go | `go.mod`（+ `go.work` controller） | require=runtime；replace 是修飾子不是邊 |
| rust | `Cargo.toml` | [dependencies]=runtime, [dev-dependencies]=development, [build-dependencies]=build, `optional=true`→optional, `[target.'cfg(...)'.dependencies]` 記 condition |
| python | `pyproject.toml`（需 `[project]`） | project.dependencies=runtime, optional-dependencies=optional |

TOML 治理邊界（凍結）：Cargo 相依條目只解讀 inline table 的
`version / path / package / workspace / optional` 五個欄位；出現其他欄位
（`git`、`features`…）或 dotted key（`serde.workspace = true`）→ 該條目
unsupported → coverage `partial`、零邊零 unresolved。python 相依字串取 PEP 508
前導名稱並做 PEP 503 正規化；含 `@`（direct reference）→ unsupported。

## 邊解析（五個語法類 + catch-all）

1. **path-form**（node `file:`/`link:`、cargo `path`、go path-replace）：
   stat → realpath 圍籬（逃出 corpus → `outside_corpus`）→ 目標 manifest 比對。
   go 另驗 module identity。落空原因：`missing_target` / `outside_corpus` /
   `budget_skipped_target` / `unreadable_target` / `target_not_in_corpus`。
2. **workspace-intent**（`workspace:*`）：架構集內按名稱找唯一成員 → local；
   零匹配 → `missing_workspace_member`；多重 → `ambiguous`。
3. **template-inheritance**（cargo `workspace = true`）：先向最近的 confirming
   cargo controller 展開模板再分類；無模板 → `missing_workspace_template`
   （evidence `template: null`）。
4. **registry-form**：雙集合判定——架構集匹配 >1 → `ambiguous`；=1 → 只有 node
   `*`（star）可判 local，其餘 range/dist-tag → `unverified_workspace_match`；
   =0 但 candidate shadow 存在 → `unverified_workspace_match`（候選擋外部性證明）；
   全空 → external。**rust 例外**：本地節點永不參與 registry 匹配，version 依賴
   一律 external。node 版本規格判定是詞法的：`*` → 凍結 EBNF range 子集
   （wildcard 只能在尾端、pre-release 後綴僅限三段全數字）→ dist-tag regex → catch-all。
5. **go 複合宣告**：require 是單位；replace 依適用性（old-module 相符 ∧
   old-version 缺省或完全相符）修飾。module-to-module replace 與 go.work replace
   是 blocker：零邊零 unresolved，coverage 歸因各記在 go.mod / go.work 自己身上。

Catch-all（git URL、`npm:` alias、非陣列欄位…）→ coverage `partial` + 診斷，
零邊零 unresolved。

## 預算與省略

| 預算 | 值（`repo-intake.json` `manifest_map.budgets`） | 超出時 |
|------|------|--------|
| manifest 數 | 500 | 路徑排序後截斷，`omissions[{reason:"manifest_budget", count, sample}]` |
| 單檔 bytes | 1 MiB | coverage `skipped` / `budget_exceeded` |
| md `--top` | 12 | 只截 md 投影；json 永不截斷（帶 `top_ignored_in_json` 診斷） |

語料列舉：`git ls-files -z --cached --others --exclude-standard`（NUL 切分、
不 trim——含空白或換行的合法路徑不失真），非 git 目錄退回檔案樹遍歷。

## 環偵測（`--cycles`）

架構集內 local 邊、以 `(from,to,scope,condition)` 去重後跑疊代式 Tarjan SCC
（無遞迴，深鏈不爆疊）。環間以最小成員 ID 排序（平手比完整節點清單）；環內節點
lexical、邊按 tuple 排序。分類：`runtime` / `development` / `mixed`；self-loop 單獨標記。
