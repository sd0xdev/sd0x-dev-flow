# Tech Spec — repo-intake Manifest Map（宣告依賴地圖）

> 狀態：已實作 v12（文件修訂版號；實作與測試檔頭引用的解析契約版本為 v11，v12 僅回寫文件、
> 未改契約。WB1–WB8 完成；code review ✅ Ready、test adequacy ✅ Tests sufficient、
> precommit ✅ PASS）· 2026-08-14
> 來源決策：`/codex-brainstorm` 三輪對抗辯論（含紅隊回合）之 Nash equilibrium——不新增獨立
> skill，以 `repo-intake` 新模式試點；升格為獨立 skill 需通過 § 8 的證據閘。
> 行數例外（write-time budget）：本文件略超 400 行目標（`wc -l` 現值 518），超出部分全數在
> § 3.4–3.6 的 fail-closed 解析契約與 § 6 對應 fixture——這是一個不可分割的論證（每條解析
> 規則都有配對的負向測試），拆開會使規則與其反證分居兩檔。

## 1. 需求摘要

### 問題

AI agent 要理解一個多套件／多語言 repo 的架構時，現有工具鏈有一個缺口：`repo-intake` 只有
節點（entrypoints、dirs、tests）沒有邊；`code-explore` 用 Grep/Read 做符號層探索但不留可查
詢的結構。對「crates/api 依賴哪些本地套件」「哪些 workspace 宣告依賴了 shared-lib」這類
**套件拓撲**問題，agent 只能逐一讀 manifest。

### 目標

為 `repo-intake` 新增 **manifest map** 能力：在定義明確的 manifest 語料（§ 3.2）上解析
**宣告依賴**（declares_dependency），組成多語言套件拓撲圖，提供 overview、反向宣告依賴、
宣告環偵測三種有界查詢。

### 明確非目標（均衡立場，不重新辯論）

| 非目標 | 理由 |
|--------|------|
| 不叫 code graph | manifest 只證明「A 宣告了 B」，不證明 import／呼叫／runtime 影響 |
| 不做 source import 邊（L1）、符號／呼叫層（L2） | L1 走既定擴充階梯後補；L2 已移出 roadmap，路由給 `/code-explore` |
| 不寫任何語言的 source lexer | 維護模型不成立（Node-only CI） |
| 不新增快取子系統 | L0 重建成本低於快取驗證；每次即時重算 |
| 不新增獨立 skill、不動 skill-catalog | 試點期；升格見 § 8 |
| 不觸網、不自動安裝、不執行 repo 內指令 | 純檔案讀取＋解析，零執行面 |

## 2. 既有程式碼分析

| 資產 | 位置 | 復用方式 |
|------|------|----------|
| 檔案列舉（git ls-files → walk fallback）＋ ignore_prefixes | `skills/repo-intake/scripts/scan_repo.js:115-150,591-596` | 復用模式但改列舉指令（§ 3.2）——原版只列 tracked 檔且以換行切割 |
| 生態 manifest 清單與**生態命名** | `scripts/config/repo-intake.json` `ecosystem_manifests`（`node`/`go`/`rust`/`python`/`php`…） | 擴充新設定段 `manifest_map`；**生態 token 沿用既有命名**（§ 3.3），不另創 `npm`/`composer` 同義詞 |
| plugin root 解析慣例（env sentinel → walk-up） | `scan_repo.js:21-32` | 照抄同一慣例 |
| 既有 shallow 生態偵測的缺陷 | `scan_repo.js:195-226` 只看 repo root | 本功能的遞迴探索正是對此的修正；不改動原函式 |
| JSON 輸出 → md 渲染的單一資料源模式 | `scan_repo.js` report 物件 | manifest map 同樣先組 JSON、md 是投影 |
| 圖演算法先例（Tarjan SCC `scan-repo.js:329-379`、Kahn 拓撲 `:397-448`） | `skills/sharingan/scripts/` | 概念復用；實作改為**迭代式**，不共用程式碼 |
| script 執行慣例（注入 `PLUGIN_ROOT`、以 node 派發 `.js`） | `scripts/run-skill.sh` | 新 script 走同一入口；E2E 測試也走它（§ 6） |

## 3. 技術方案

### 3.1 形態

新增一支零依賴 script：`skills/repo-intake/scripts/manifest_map.js`。

```
/bin/bash -p -- scripts/run-skill.sh repo-intake manifest_map.js [--format md|json] [--top N]
/bin/bash -p -- scripts/run-skill.sh repo-intake manifest_map.js --reverse <selector>
/bin/bash -p -- scripts/run-skill.sh repo-intake manifest_map.js --cycles
```

每次執行即時重建（無快取）。`--format md`（預設）輸出有界投影；`--format json` 輸出 § 3.3
的 envelope。`--top` 僅作用於 md 投影，JSON 模式下忽略並在 `diagnostics` 註記一筆
`top_ignored_in_json`。CLI 對無值的 `--reverse`、互斥模式併用、非法 `--format`／`--top`
一律 exit 2 並輸出用法。

### 3.2 Manifest 語料（corpus）

列舉指令：`git ls-files -z --cached --others --exclude-standard`——**tracked ＋ untracked 且
未被 ignore** 的檔案，以 NUL 切割、**不 trim** 路徑值（合法路徑可含前導空白甚至換行），再套
`ignore_prefixes` 過濾。非 git repo 時退回 `walkFiles` 同款目錄走訪。

讀檔契約（記憶體有界）：先 `open` ＋ `fstat` 檢查大小——超過預算（§ 3.7）者**不讀取內容**，
直接記 `skipped: budget_exceeded`；未超過者做**有界讀取**（至多 limit＋1 bytes）取得
`Buffer`，再以 `TextDecoder('utf-8', {fatal: true})` 解碼——Node 的 `readFileSync(p,'utf8')`
對非法位元組是靜默替換而非拋錯，不可用。解碼失敗、路徑消失、無權限 → coverage 記
`skipped: unreadable`，不中斷整體建圖。語料在預算裁切**之前**先按路徑排序，保證同一 tree
的輸出確定性。

### 3.3 資料模型

生態 token（公開契約，與 `repo-intake.json` `ecosystem_manifests` 的鍵一致）：
`node`（package.json）、`php`（composer.json）、`go`、`rust`、`python`。ID 形式：
workspace 節點 `ws:<ecosystem>:<dir>`；外部套件 `ext:<ecosystem>:<name>`。

`--format json` 一律輸出同一個 envelope。`query` 是 discriminated union：

| kind | 欄位 | results 元素 | 排序 |
|------|------|--------------|------|
| `overview` | 只有 `kind` | —（無 results） | — |
| `reverse` | `kind`、`selector`（正規化後的精確 ID） | edge 物件（同 `artifact.edges` 形狀） | 按 `from` ID 字典序 |
| `cycles` | 只有 `kind` | `{classification: "runtime\|development\|mixed", nodes: [], edges: [], selfLoop: bool}` | 環間與環內排序見 § 3.8 |

```json
{
  "schemaVersion": 1,
  "query": { "kind": "reverse", "selector": "ws:rust:crates/storage", "results": [] },
  "artifact": {
    "generatedAt": "…",
    "root": "…",
    "workspaces": [
      { "id": "ws:rust:crates/api", "name": "api", "nameSource": "manifest | null",
        "ecosystem": "rust", "manifest": "crates/api/Cargo.toml",
        "role": "confirmed_workspace | candidate_workspace | standalone_root",
        "flags": ["likely_fixture"] }
    ],
    "controllers": [
      { "id": "ctl:go_work:.", "controllerType": "go_work | node_workspaces | pnpm_workspace | cargo_workspace",
        "manifest": "go.work",
        "membershipStatus": "parsed | partial | unknown",
        "members": ["ws:go:services/api"],
        "diagnostics": [ { "construct": "unsupported member pattern", "value": "…" } ] }
    ],
    "externals": [ { "id": "ext:rust:serde", "name": "serde", "ecosystem": "rust" } ],
    "edges": [
      { "from": "ws:rust:crates/api", "to": "ws:rust:crates/storage",
        "relation": "declares_dependency",
        "scope": "runtime | development | build | optional | peer",
        "resolution": "local | external",
        "evidence": { "declaration": { "manifest": "crates/api/Cargo.toml", "line": 14 } },
        "condition": "cfg(unix) | null" }
    ],
    "unresolvedDeclarations": [
      { "from": "ws:rust:crates/api",
        "requested": { "ecosystem": "rust", "name": "util",
                       "rawSpec": "…（截斷至 200 字元）", "path": "…| null" },
        "reason": "ambiguous | missing_target | target_not_in_corpus | outside_corpus | unreadable_target | budget_skipped_target | missing_workspace_template | missing_workspace_member | unverified_workspace_match",
        "candidates": ["ws:rust:crates/util"],
        "evidence": { "declaration": { "manifest": "crates/api/Cargo.toml", "line": 21 } } },
      { "from": "ws:rust:crates/api",
        "requested": { "ecosystem": "rust", "name": "serde",
                       "rawSpec": "workspace = true", "path": null },
        "reason": "missing_workspace_template",
        "candidates": [],
        "evidence": { "declaration": { "manifest": "crates/api/Cargo.toml", "line": 22 },
                      "template": null } }
    ],
    "coverage": [
      { "manifest": "…", "status": "parsed | partial | unrecognized | skipped",
        "reason": "manifest_parse_incomplete | budget_exceeded | unreadable | null",
        "unsupported": [ { "line": 18, "construct": "…" } ] }
    ],
    "omissions": [ { "reason": "manifest_budget", "count": 37, "sample": ["…"] } ],
    "diagnostics": []
  }
}
```

模型要點：

- **節點 ID 含生態**：同一目錄可同時有 `package.json` 與 `pyproject.toml`（polyglot 目錄），
  每個 manifest 一個節點，不合併。controller members、edge 端點、selector、candidates 全部
  使用此 ID 形式。
- **一個 manifest 可以同時產出套件節點與 controller 記錄**：root `package.json` 帶
  `workspaces` 欄位 → `standalone_root` 節點＋`node_workspaces` controller；Cargo 同時有
  `[package]` 與 `[workspace]` → 節點＋controller。無 `[package]` 的 virtual Cargo root 只有
  controller。
- **controller 是記錄不是圖節點**，不出現在 edges 與 cycles。ID 規則
  `ctl:<controllerType>:<manifest-dir>`（root 目錄記 `.`）——遞迴探索下同 repo 可有多個同
  類 controller（如兩個獨立的 node workspace root），ID 必須不碰撞、各自的
  members／diagnostics 不串線。`members` 只含**已解析為已處理
  節點**的精確 ID；宣告了但對不上節點的成員樣式進 controller `diagnostics`，不產 dangling
  ID。`pnpm-workspace.yaml`（無 YAML parser）記 `membershipStatus: "unknown"` 且省略
  `members`；成員樣式部分不支援 → `partial`＋diagnostics；空陣列保留給「解析成功且確實為
  空」。
- **`edges` 只含已解析的 `local | external`**。`unresolvedDeclarations` 收的是**已成功辨識
  宣告語法、但無法證明 local／external** 的宣告——保留原始宣告（`rawSpec` 截斷至 200 字
  元；path 形式另存 `requested.path`）與候選清單，**不進任何圖遍歷**。**不支援語法
  （catch-all）與 go 遮斷名單命中的 require 都不進 unresolved**：它們只留 coverage
  `partial`＋construct／diagnostics 記錄，零邊、零 unresolved——coverage 記「解析器理解了
  多少」，unresolved 記「已理解的宣告為何解不成邊」，同一失敗不重複記錄。
- **evidence 結構化**：`template` 欄位**僅出現在模板繼承的記錄上**（optional，非
  nullable-everywhere）——成功展開的邊記非 null `template`；缺項
  （`missing_workspace_template`）記 `declaration`＋`template: null`（缺項沒有可引用的模板
  行；展開規則見 § 3.6）。其他一切邊與 unresolved 記錄只有 `declaration`，**省略**
  `template` 欄位。
- 語義鐵則（輸出文件與 SKILL.md 都要載明）：邊是 `declares_dependency`，不是 import、不是
  impact；reverse 查詢結果是**直接反向宣告清單**（depth=1），不是傳播或影響範圍。

### 3.4 Workspace 分類與成員證據

**預設架構節點集 = `standalone_root` ＋ `confirmed_workspace`**——架構計數、local 邊
Top-N、reverse、cycles、以及 § 3.6 的解析匹配集合，全部使用這一個集合；
`--include-candidates` 時 candidate 加入同一集合。這是唯一的集合定義，各節不再各自定義。

| 角色 | 判定 |
|------|------|
| `standalone_root` | repo root 的**套件** manifest（有套件身分；無 `[package]` 的 virtual root 是 controller，不在此列） |
| `confirmed_workspace` | 被**任一** `membershipStatus: parsed\|partial` 的 controller 以**已證明的納入樣式**匹配（node `workspaces`、Cargo `[workspace] members` 扣除 `exclude`、`go.work use`；樣式相對 controller manifest 所在目錄解析）。**確認權限不限 repo root**——巢狀 controller（如子目錄的 Cargo workspace root）同樣確認其成員。多個 controller 重疊確認同一 manifest：confirmed 單調成立（無衝突可言），各 controller 的 `members` 各自記錄。controller 身分**不**改變其自身 manifest 的節點角色（巢狀 controller 的 manifest 自己仍依本表分類） |
| `candidate_workspace` | 遞迴發現、無成員宣告佐證的巢狀 manifest。列入 inventory 節；預設排除於架構節點集 |

**成員樣式凍結子集**（node `workspaces` 與 Cargo `members`/`exclude` 共用）：字面目錄路徑，
或**單一結尾 `*` 段**（`packages/*`）。物件形式的 node workspaces、`**`、否定、大括號等其他
樣式一律不解讀，且**納入與排除清單的失敗方向相反**：

- 不支援樣式出現在**納入**清單（`workspaces`／`members`）→ 該樣式進 controller
  `diagnostics`、`membershipStatus: partial`；其餘支援樣式的匹配仍可確認——部分理解的成員
  集**不得**默默當成完整集，但已證明的納入不因此作廢。
- 不支援樣式出現在**排除**清單（Cargo `exclude`）→ 排除範圍不可知，**任何**成員都可能其實
  被排除，該 controller 因此**不得提供任何確認**：`membershipStatus: unknown`、省略
  `members`。**unknown 是 controller-local 的證據失效，不是全域否決**：其納入樣式匹配到的
  manifest 只有在**無其他 eligible（parsed／partial）controller 獨立確認**時才維持
  `candidate_workspace`——confirmed 的單調性（本節角色表）不受影響，任一 eligible
  controller 的證明仍成立。

**成員關係 ≠ 依賴宣告**（fail-closed 核心）：`workspaces`／`members`／`use` 只用於節點分類
與解析，本身**不產生任何邊**。Cargo `[workspace.dependencies]` 是可繼承模板，同樣不產邊——
只有成員 manifest 中明確 `workspace = true` 的依賴項，才以模板內容產出該成員的邊。負向測試
必須斷言：只有成員宣告、沒有依賴宣告的 fixture 產出零邊。

php（composer）：v1 不解析 `repositories`，巢狀 `composer.json` 一律 `candidate_workspace`；
root 的仍是 `standalone_root`。路徑含 `examples/`、`fixtures/`、`testdata/`、`samples/` 的
candidate 額外標 `likely_fixture`。

### 3.5 解析器矩陣（v1 凍結清單）

| 格式 | 解析方式 | 抽取欄位 |
|------|----------|----------|
| `package.json` | `JSON.parse` | name、dependencies、devDependencies、peerDependencies、optionalDependencies、workspaces（僅成員證據，§ 3.4 凍結子集） |
| `composer.json` | `JSON.parse` | name、require、require-dev |
| `go.mod` | 行導向 recognizer | module、require（單行＋block）、replace（**保留 old module、選擇性 old version、target 種類**——相對路徑或 module@version，§ 3.6 依此判定適用性） |
| `go.work` | 同一 recognizer | use（單行＋block；僅成員證據，controller 記錄）、replace（同款辨識；僅作 fail-closed 遮斷名單，§ 3.6） |
| `Cargo.toml` | **保守 TOML 欄位 recognizer** | package.name、workspace.members ＋ workspace.exclude（僅成員證據）、workspace.dependencies（僅模板）、[dependencies]／[dev-]／[build-]、inline table 的 version/path/package/workspace/optional、`[target.'cfg(…)'.dependencies]`（cfg 保留為不透明 condition，不求值） |
| `pyproject.toml` | 同一 recognizer | project.name、project.dependencies、project.optional-dependencies；依賴字串只抽可證明的前導 distribution name（PEP 503 正規化），URL／editable／複雜 marker → partial |

**go.work use operand 凍結子集（違反即 spec 變更）**：`use` 的 operand 只接受**相對路徑**，
裸字或雙引號字面值兩種形式。落在子集外的一律 fail-closed 為 membership failure（controller
標 `partial`，絕不確認成員）：絕對路徑與 drive-qualified 路徑（`/abs`、`C:/abs`——合法 Go
但非 controller-relative，照字面接合會確認錯誤目錄）、反斜線／Windows 分隔符、引號內任何
escape 序列（不解碼、不比對）、Go modfile lexer 單獨 token 化的標點（`(){}[],`、各式引號）、
以及未加引號的 `/*`（Go 拒絕 block comment，該行是 malformed Go 而非字面路徑；
加引號的 `"*"` 則是合法字面值，不展開 glob，只做精確比對）。字元邊界對齊 Go lexer 的
`!unicode.IsSpace && unicode.IsPrint`，以**正向表列**實作：operand 只允許 Unicode printable
類別（L/M/N/P/S）加引號內的 ASCII 空格——ASCII C0/DEL 之外的控制與格式字元（如 U+0085、
U+200B、U+2060）同樣 fail-closed，兩種形式皆然。operand 必須**非空**：`use ""` 在 Go 會
解析為 controller 目錄本身，但空字串在凍結子集之外，fail-closed 而非默默等同 `use .`。
路徑正規化後僅拒真正的 parent escape（`..` 與 `../` 前綴）；字面上以 `..` 開頭的目錄名
（如 `..cache`）在 corpus 內，照常比對。

**go.mod／go.work 一般 token 凍結子集（違反即 spec 變更）**：`module`、`require`（單行與
block）、`replace` 的全部 token 位置（old module、old version、target、target version）共用同一
conservative recognizer——bare token 或雙引號字面值兩種形式，**不解碼 escape**（含反斜線一律
fail-closed，與 use operand 同一慣例）、非空、同一 Unicode printable（L/M/N/P/S）邊界。quoted
合法形式解碼為裸值（`"example.com/lib"` → `example.com/lib`——保留引號會鑄造錯誤的
`ext:go:"…"` 節點）；任一 token 落在子集外 → 該行整筆 fail-closed 為 unsupported——該行不產生
其對應的證據（module identity、該筆依賴宣告或該筆 replace 遮斷），其他合法行的證據不受影響。
若失敗的是 go.mod 的 module token，該 go.mod 節點仍以 `name: null` 進 workspace inventory
（coverage `partial`）；go.work 無論如何只產生 controller 記錄，不進 inventory。

**TOML recognizer 治理邊界（凍結，違反即 spec 變更）**：只辨識上列具名欄位；無關區段
（如 `[tool.ruff]`）的任何語法都不影響 coverage；依賴相關欄位遇到不支援語法 → 該 manifest
標 `partial: manifest_parse_incomplete` 並列出 construct，**絕不猜測產邊**；擴充更多 TOML
語法不是修 recognizer，而是改走生態原生工具（如 `cargo metadata --offline` adapter）的決策。

明確不解析（detection only，coverage 標 `unrecognized`）：`pom.xml`、`*.csproj`、
`build.gradle*`、`Gemfile`、`setup.py`、`requirements.txt`（deferred）、lockfiles、
Bazel/CMake。`pnpm-workspace.yaml` 特例：不解析內容，但記為 `membershipStatus: unknown`
的 controller（§ 3.3）。

### 3.6 邊解析（edge resolution）——語法分類 → 各類自有的目標解析

「同名」不是 local 的證明。解析分兩步：先按**宣告語法**分類（從宣告本身判定，與目標無關），
再走**該語法類自己的**目標收集與判定規則——沒有跨類共用的 fallback，每一類窮盡列出自己的
收尾方式：

**Step 1 — 語法分類**：

| 語法類 | 例 | 目標解析（Step 2） |
|--------|----|--------------------|
| path 形式 | Cargo `path =`、node `file:`／`link:` | 目標唯一＝宣告的路徑本身，無收集步驟；走路徑驗證（下方） |
| workspace 意圖 | node `workspace:` 協定 | 對架構節點集（§ 3.4，同生態）收集同名節點：0 個 → `missing_workspace_member`；1 個 → `local`；>1 個 → `ambiguous`（candidates 按 ID 排序） |
| 模板繼承 | Cargo `workspace = true` | **先展開 root `[workspace.dependencies]` 模板，再按展開結果分類**：模板缺該項 → `missing_workspace_template`（evidence：`declaration`＋`template: null`）；模板含 `path` → 按 path 形式解析；模板為 registry version → 按 rust registry 規則（`external`）。成功展開的兩種結果 evidence 同時記 `declaration` 與 `template` |
| registry 形式 | 裸 version spec——node 限定為可辨識的 semver range／`*`／dist-tag；rust／python／php 為版本（含 inline table 的 version）；go 見複合宣告 | 各生態自己的規則表（下方） |

**Catch-all（窮盡性保證）**：落不進上述任何類的宣告 spec——node 的 Git URL、HTTP(S)
tarball、GitHub shorthand、`npm:` alias 等——v1 一律視為**不支援的宣告語法**：該 manifest 標
`partial: manifest_parse_incomplete` 並列出 construct，該宣告**不產邊、不進
unresolvedDeclarations**（與 § 3.5 TOML 治理邊界同一原則：不解析就不猜）。因此 Step 1 對任
何合法 manifest 內容都有唯一歸屬：**四個語法類（path／workspace 意圖／模板繼承／registry）
＋ go 複合宣告流程**，或不支援語法。

**node version spec 詞法判定（凍結，依序取第一個匹配）**——registry 形式的三個子形態必須
可機械辨識，否則同一字串會被不同實作分到 registry 或 catch-all：

1. 精確 `*` → registry 形式（`local` 規則）；
2. **凍結 semver-range 文法**（下方 EBNF）——整串必須被 `range-set` **完整消耗**，任何殘餘
   即不匹配（`v1` 是版本不是 tag）；
3. **dist-tag**：匹配 `^[A-Za-z][A-Za-z0-9._-]*$` 且**不**匹配第 2 條文法（數字開頭的 tag
   不辨識——落 catch-all，保守偏 partial 不猜）；
4. 其餘（含 `/`、`@`、協定字首、類 semver 但不合法的字串）→ catch-all。

```ebnf
range-set   = conjunction , { [WS] , "||" , [WS] , conjunction } ;
conjunction = atom , { WS , atom } ;                   (* 空白分隔的 AND *)
atom        = [ comparator ] , version
            | version , WS , "-" , WS , version ;      (* hyphen range：恰兩端、
                                                          不帶 comparator、不可連鎖 *)
comparator  = "^" | "~" | ">=" | "<=" | ">" | "<" | "=" ;
version     = [ "v" ] , part , [ "." , part , [ "." , part ] ]
            , [ "-" , idents ] , [ "+" , idents ] ;
part        = digits | "x" | "X" | "*" ;
idents      = ident , { "." , ident } ;
ident       = idchar , { idchar } ;                    (* 非空 *)
idchar      = digit | "a"…"z" | "A"…"Z" | "-" ;
digits      = digit , { digit } ;
digit       = "0"…"9" ;
WS          = ( " " | "\t" ) , { " " | "\t" } ;        (* 不含換行——spec 是單行值 *)
```

**消歧規則（機械可實作）**：先以 `||`（含兩側任意 WS）把整串切段，再對每段套
`conjunction`——operator 前的 WS 屬於 operator，不被 conjunction 吞掉；任一段為空即整串不
匹配。`1||2` 與 `1 || 2` 都合法；`1||`、`||1`、`1 ||` 都不合法。**Post-parse validation
（兩條，與文法同屬凍結契約）**：(a) wildcard part 之後不得再出現 digits part（wildcard 僅限
尾端連續位置）；(b) `-idents`／`+idents` 尾碼僅當三段 part 皆為 digits（無 wildcard）時合
法。違反任一 production 或 validation——空 OR operand、重複 comparator（`>= <=1`）、連鎖
hyphen（`1 - 2 - 3`）、空尾碼（`1.2.3-`）、wildcard 非尾端（`1.x.3`）——整串不匹配，落入
第 3 步或 catch-all。文法是**凍結子集**，不承諾與 npm 完整 range 語義等價：v1 的用途只是分
流 registry／tag／catch-all，接受度寧缺勿濫。

`workspace = true` **不是** workspace 意圖——它宣告的是「用 root 模板的內容」，指向哪裡由
模板決定，分類必須發生在展開之後。

**路徑驗證**（所有 path 形式，含模板展開出的 path 與 go replace 指定的 path）：相對路徑以
**宣告所在 manifest** 的目錄正規化（模板展開的 path 例外——Cargo 語義以 root 模板所在目錄
為基準）；containment 採**物理**判定（`fs.realpath` 後仍須在 repo root 內），symlink 逃逸 →
`outside_corpus`；目標必須是**已處理**的套件 manifest（可指向 root 套件節點——path 形式不限
confirmed 成員）。失敗細分：正規化路徑上無檔案 → `missing_target`；檔案存在但不在已處理語料
（被 ignore、unrecognized、非套件 manifest、或 module 身分不符——見 go）→
`target_not_in_corpus`；讀取失敗 → `unreadable_target`；被預算略過 →
`budget_skipped_target`。全部不產邊、不捏造節點。

**registry 形式——各生態規則**。rust 例外在先：**本地節點根本不是合格目標**（Cargo 語義：
裸 version 即 registry，同名成員不改變此事實）——不收集任何本地集合、一律 `external`。

其餘生態（node／python／php）收集**兩個集合**（皆同生態、同名——node 按套件名，python 按
PEP 503 正規化名，php 按 composer 套件名）：`archMatches`＝§ 3.4 架構節點集內的匹配；
`candidateShadows`＝`candidate_workspace` 內的匹配（`--include-candidates` 後 candidate 已屬
架構集，此集合恆空）。判定順序唯一：

1. `archMatches` >1 → `ambiguous`（candidates 按 ID 排序）；
2. `archMatches` =1 → 依下表；
3. `archMatches` =0 且 `candidateShadows` 非空 → `unverified_workspace_match`；
4. 兩集合皆空 → `external`。

| 生態 | `archMatches` 恰 1 個時 |
|------|--------------------------|
| node | version spec 為 `*` → `local`；一般 semver range（v1 不做相容判定）與 dist-tag（`latest`、`next` 等）→ `unverified_workspace_match`（tag 指向 registry 發佈版本，無法證明即本地節點） |
| python | `unverified_workspace_match`（PEP 621 無 path 形式，無可靠 local 證明） |
| php | `unverified_workspace_match`（v1 不解析 `repositories`） |

**go——複合宣告，`replace` 自身永不產邊**：宣告單位是 `require`；`replace` 與 `go.work use`
只是佐證。recognizer 對每條 replace 保留 old module、選擇性 old version、target 種類
（§ 3.5）。**適用性（applicability）——對所有 replace 種類同一定義**：一條 replace 適用於
某 require，當且僅當 old module 相符，**且** old version 缺省或精確等於該 require 的版本。
版本不符的 replace 對該 require **視同不存在**——相對路徑、module-to-module、go.work 三者
皆然（fail-closed 不等於過度遮斷：不適用的 replace 不得改變 require 的解析結果）。只有
**適用**的 replace 才能進入相對路徑分支或遮斷名單。

**遮斷名單（fail-closed，先於下列分支）**：適用的 **module-to-module replace**（target 是
module@version），以及 go.work 中適用的任何 replace——這些改寫了 require 的解析目標而 v1
不模擬轉向：該 require **不產邊、不進 unresolvedDeclarations**（記錄在 coverage／
diagnostics 側，§ 3.3 的分工），不得按原 require 猜 local 或 external。coverage 歸屬明
定：go.mod 內的 module-to-module replace → **該 go.mod** 標
`partial: manifest_parse_incomplete`（construct 記該 replace 行）；go.work 的 replace →
**go.work 的 coverage** 標 partial 並記入其 controller `diagnostics`（construct 記該
replace 行），受影響的 go.mod **不因此降級**——其內容已被完整解析，遮斷的來源與記錄都在
go.work 側，否則一條 go.work replace 會把全 repo 的 go.mod 都拖成 partial。

未被遮斷的 require 依序：

1. 有**適用**的相對路徑 replace → 該 replace 指定唯一目標路徑，走路徑驗證，且目標 manifest
   的 `module` 宣告必須等於 require 的 module path（不符 → `target_not_in_corpus`）。通過 →
   `local`。
2. 無適用 replace，但 `go.work use` 涵蓋的某目錄其 `module` 宣告等於 require 的 module
   path → `local`。
3. 無佐證，但 in-corpus 存在同 module path 的宣告 → `unverified_workspace_match`。
4. 皆無 → `external`。

孤立的 `replace`（無對應 require）不產生任何記錄；負向測試斷言之。

原則不變：**in-corpus 候選的存在使 externality 不可證明**（除 rust——其語義明確 registry
優先）——寧可 unresolved，不偽造 external。

### 3.7 有界輸出與預算

| 預算 | 預設 | 超出行為 |
|------|------|----------|
| manifest 數 | 500 | 路徑排序後取前 500；被略過者記 `omissions[]` 一筆 `{reason: "manifest_budget", count, sample}`，sample 取排序後前 `sampleLimit`（預設 12）條 |
| 單一 manifest 大小 | 1 MiB（1,048,576 bytes） | `fstat` 判定，**不讀取內容**，coverage 標 `skipped: budget_exceeded` |
| md 投影每節列數 | `--top`（預設 12） | 截斷並標註省略數 |

md overview 輸出節次：workspace inventory（依 role 分組，candidate 含 `likely_fixture`
標記）、架構計數（§ 3.4 架構節點集）、local 邊 Top-N、外部依賴計數、unresolved 計數、
coverage／omissions 摘要、尾註「宣告不證明 import 或 runtime 影響」。完整資料在
`--format json`；JSON 的完整性僅及於已處理語料（omissions 載明缺口）。

### 3.8 查詢語義

- `--reverse <selector>`：selector 接受精確節點 ID（`ws:<ecosystem>:<dir>` 或
  `ext:<ecosystem>:<name>`——外部套件可查「誰宣告了它」）、`ecosystem:name`、或裸名稱。
  後兩者對 workspace 與 external 節點一起解析：匹配 0 個 → exit 2（not found）；恰 1 個 →
  執行；>1 個 → exit 2 並列出全部精確 ID。結果為**直接**（depth=1）反向
  `declares_dependency` 邊，置於 `query.results`（§ 3.3 排序）；md 受 `--top`，JSON 回傳
  全部直接邊。不做遞移閉包（v1.1 再議，屆時需 depth／節點預算）。
- `--cycles`：迭代式 SCC（顯式堆疊），在 § 3.4 架構節點集的 local 邊上跑（含
  root——root↔member 環必須可偵測）。邊先去重（同 `(from, to, scope, condition)` 合併——
  不同 cfg condition 的宣告是不同的邊，不得跨 condition 合併）；自環獨立列出
  （`selfLoop: true`）。分類：全 runtime／全 development／`mixed`（build/optional/peer 計入
  mixed 判定）。**排序（輸出確定性的一部分）**：環間按最小成員 ID 字典序，最小 ID 相同時比
  較整個排序後的節點串列；環內 `nodes` 按 ID 字典序，`edges` 按
  `(from, to, scope, condition)` 元組字典序（`condition` 為 null 排最前）。結果置於
  `query.results`。命名為 **manifest cycles**（宣告環）。

## 4. 風險與對策

| 風險 | 對策 |
|------|------|
| TOML recognizer 因 issue 壓力長成完整 parser | § 3.5 治理邊界；測試斷言「不支援語法 ⇒ partial 診斷、⇏ 產邊」 |
| 成員關係被誤當依賴（偽造邊） | § 3.4 分離兩種證據＋零邊負向測試 |
| 同名誤判 local／偽造 external | § 3.6 兩步制：先語法分類、各類自有目標收集與收尾（無通用 fallback）；in-corpus 候選阻斷 externality |
| candidate workspace 污染結論 | § 3.4 單一架構節點集定義＋`likely_fixture` 標記 |
| false completeness（使用者把宣告圖當 import 圖） | 命名紀律＋overview 尾註＋reverse 語義限定 depth=1 |
| 惡意／超大／非法編碼 manifest | § 3.2 fstat 先行＋有界讀取＋fatal decode；解析全程無 eval、無執行 |
| 路徑含空白／換行；symlink 逃逸 | § 3.2 NUL 切割不 trim；§ 3.6 物理 containment；fixtures 覆蓋 |

依賴：無新增外部依賴；Node 18+（既有需求，`TextDecoder` 為全域內建）。

## 5. 工作分解

| WB | 內容 | 產出 |
|----|------|------|
| WB1 | 設定段 `manifest_map`（辨識清單、預算、sampleLimit、fixture 路徑樣式）＋語料列舉（§ 3.2） | `scripts/config/repo-intake.json` 擴充；`manifest_map.js` 骨架 |
| WB2 | JSON 系解析器（package.json、composer.json）＋成員證據解讀（凍結子集） | 解析層可獨立測試（完整可用交付在 WB6 後） |
| WB3 | go.mod／go.work 行導向 recognizer | 同上 |
| WB4 | 保守 TOML 欄位 recognizer（Cargo＋PEP 621）＋partial 診斷 | 同上 |
| WB5 | 圖組裝：workspace／controller 分類、§ 3.6 兩步解析、unresolvedDeclarations、coverage／omissions | 同上 |
| WB6 | 查詢與渲染：envelope union、overview／reverse／cycles、CLI 驗證、預算、md 投影 | 端到端可用 |
| WB7 | 測試補齊：fixture 矩陣、透過 runner 的 E2E 案例（§ 6） | `test/skills/repo-intake/` 測試群 |
| WB8 | `skills/repo-intake/SKILL.md` 增補模式文件（行數目標 <150，原 99 行、完成後 129 行；細節移 `skills/repo-intake/references/manifest-map.md`）＋doc sync | SKILL.md、reference、本 spec 狀態更新 |

每個 WB 完成即受 `/codex-review-fast` → `/precommit` 閘門；解析器逐個落地。

## 6. 測試策略

- 位置：`test/skills/repo-intake/manifest-map.test.js`＋`test/skills/repo-intake/fixtures/`。
  測試發現由兩道既有機制保證：`npm test`／`test:ci` 的 `find` 列舉涵蓋所有 `*.test.js`；
  `test:schema` 的 `test/skills/*/*.test.js` glob 涵蓋此巢狀路徑。
  `test/scripts/package-test-coverage.test.js` 分別驗證這兩件事（`npm test` 覆蓋全集、四段
  partition 等於全集），非驗證兩者聯集。
- 每個解析器的 fixture 矩陣：最小合法檔、block／單行、成員宣告（斷言零邊）、成員 glob 凍結
  子集正反例（`packages/*` 可解析；納入清單含 `**`／物件形式 → `membershipStatus: partial`
  但支援樣式的成員仍 confirmed；**排除清單含不支援樣式 → 該 controller `unknown`、省略
  members；控制案限定「無其他 eligible controller 確認」時匹配 manifest 維持 candidate**
  ——有獨立正向證據的重疊案由後述 overlap fixture 覆蓋）、Cargo `workspace.exclude`、本地／外部／改名依賴、scope 各值、
  `workspace = true` 繼承三分支（模板缺項 → `missing_workspace_template`＋`template: null`，
  **「區段存在但缺 key」與「整個 `[workspace.dependencies]` 區段不存在」兩案分測**；path 模
  板 → local 邊；version 模板 → external 邊，後兩者斷言 evidence 同時帶 `template`）、
  node 遠端／alias spec（Git URL、HTTP(S) tarball、GitHub shorthand、`npm:` alias → 斷言
  partial＋**零邊、零 unresolved**；正控制：裸 semver 正常產邊）、node version spec 詞法邊
  界（`latest` → dist-tag；`^1.2.3`／`v1`／`1.x` → semver range；`1.2.3.4.5` →
  catch-all；`user/repo` → catch-all；數字開頭 tag → catch-all；**OR 空白正反向**：
  `1||2`、`1 || 2` → range；`1||`、`||1`、`1 ||` → catch-all；**畸形組合**：`>= <=1`、
  `1 - 2 - 3`、`1.2.3-`、`1.x.3` → 皆 catch-all）、同 repo 多個同類
  controller（兩個獨立 node workspace root → ID `ctl:<type>:<dir>` 不碰撞、
  members／diagnostics 不串線）、巢狀 controller 確認成員（子目錄 Cargo.toml **同時含
  `[package]` 與 `[workspace]`**：斷言 controller 記錄存在、其 package 節點無人確認維持
  candidate、其 members 為 `confirmed_workspace`；對照組：virtual root（無 `[package]`）只
  產 controller、不產節點）、**unknown 與正向證據重疊**（controller A 因不支援 exclude 為
  unknown、controller B parsed 且確認同一 manifest → 全域角色 confirmed、A 省略 members、
  B 正常列出）、go 複合宣告
  （require＋相對 replace → local；**孤立 replace → 零記錄**；目標 module 身分不符 →
  `target_not_in_corpus`；**版本不符的 replace 視同不存在——相對路徑、module-to-module、
  go.work 三種各一個 version-mismatch fixture，斷言落入後續四分支**；適用的
  module-to-module replace → 該 require 零邊＋該 go.mod partial；適用的 go.work replace →
  遮斷＋go.work coverage partial＋controller diagnostics，**受影響 go.mod 維持 parsed**）、
  node `workspace:` 零匹配 → `missing_workspace_member`、registry 判定順序四分支
  （archMatches 多義／恰一／candidateShadows 非空 → `unverified_workspace_match`／兩集合皆
  空 → external）、node dist-tag（0 匹配 → external；恰 1 → `unverified_workspace_match`）、
  註解與空白、CRLF＋BOM、**非法 UTF-8 位元組**（斷言
  `skipped: unreadable`，不可是替換字元後被解析）、不支援之相關語法（斷言 partial）、不支援
  之無關語法（斷言不影響 coverage）、截斷檔、同生態撞名（斷言 `ambiguous`＋排序
  candidates）、超大檔（斷言 fstat 擋下、未讀內容）、無名 root（name:null）、**同目錄
  polyglot**（兩個節點、ID 不撞）、**前導空白路徑**（證明不 trim）、**目錄名含換行**（證明
  NUL 切割）。
- 核心不變量（負向控制，同 commit 內含正反兩向）：
  `整檔讀取／UTF-8 解碼失敗、JSON document parse 失敗，或超出單檔 byte 預算 ⇒ skipped`
  （`unreadable` / `budget_exceeded`；corpus 數量預算走 `omissions`，不是 skipped）；
  `Go/TOML recognizer 已辨識相關 construct 的畸形或不支援語法 ⇒ partial 診斷`
  （行導向／區段導向 recognizer 對整體畸形文件仍回 ok，逐 construct 記 partial）；
  `已解讀宣告但無法落邊 ⇒ unresolvedDeclarations`；上述三類皆 `⇏ 任何猜測邊`；
  `成員宣告 ⇏ 邊`；`同名 ⇏ local`；`in-corpus 候選存在 ⇏ external`（rust 除外）。
- 圖層測試：candidate 預設排除、unresolved 不進遍歷、path 驗證五種失敗 reason（含 symlink
  逃逸 → `outside_corpus`）、root 參與解析與環偵測（root↔member 環 fixture）、迭代 SCC 對
  1000+ 節點鏈不爆疊、自環獨立、mixed-scope 環分類、環間與環內排序符合 § 3.8 定義（含最小
  ID 相同的 tie-break fixture）、同端點同 scope 不同 cfg condition 的兩條邊在環中不合併。
- 確定性：以**正規投影**（排除 `generatedAt` 與環境相依的 `root`）斷言「同語料 ⇒ 同輸出」，
  或於測試注入固定時鐘。
- E2E（經 `/bin/bash -p -- scripts/run-skill.sh repo-intake manifest_map.js …`，驗證
  PLUGIN_ROOT 注入與派發）：md、json、reverse（含 `ext:` selector 與多義 exit 2）、cycles、
  `--include-candidates`、非法引數（exit 2）。

## 7. 開放問題

1. `scan_repo.js` full report 是否內嵌 `declaredDependencyMap` 摘要——v1 先不嵌，避免拖慢
   既有掃描；WB6 後重估。
2. `--include-candidates` 之外是否需要 `.claude/` 層級的 workspace 覆寫設定——等真實 repo
   回報誤分類再議（YAGNI）。
3. requirements.txt 的有界子集、node semver 相容判定（解除 `unverified_workspace_match` 的
   大宗）、reverse 遞移閉包——皆 v1.1 再議。

## 8. 升格證據閘（獨立 `/code-graph` skill 的前提，全部成立才啟動）

1. manifest map 在 onboarding 之外有實際重複使用；
2. 重複查詢頻率證明快取／查詢面值得；
3. 對照「直接讀 manifest＋code-explore」有 benchmark 優勢；
4. ≥2 個生態有可靠 L1 import adapter（走階梯：已安裝分析器 CLI → 預產 artifact →
   opt-in adapter）；
5. 路由描述與 repo-intake／code-explore 不重疊。
