# sd0x-dev-flow

**言語**: [English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | 日本語 | [한국어](README.ko.md) | [Español](README.es.md)

[Claude Code](https://claude.com/claude-code) 向け開発ワークフロープラグイン。Codex MCP 連携はオプションです。

90以上のツールでコードレビュー、テスト、調査、セキュリティ監査、DevOps 自動化をカバー。

## 極小の Context 使用量

本プラグインは Claude の 200k Context Window のわずか **~4%** で 90 以上のツールを提供します。これは重要なアーキテクチャ上の優位性です。

| コンポーネント | トークン数 | 200k に対する割合 |
|---------------|-----------|-----------------|
| ルール（常時読み込み） | 5.1k | 2.6% |
| スキル（オンデマンド） | 1.9k | 1.0% |
| エージェント | 791 | 0.4% |
| **合計** | **~8k** | **~4%** |

なぜこれが重要か：

| メリット | 説明 |
|---------|------|
| コードに多くの余裕 | 96% の Context をプロジェクトファイル、diff、会話に使えます |
| パフォーマンスへの影響なし | プラグインのオーバーヘッドは極めて小さく、応答速度に影響しません |
| スキルはオンデマンド読み込み | 実行したスキルのみ読み込まれ、未使用スキルはトークンを消費しません |
| 複雑なシナリオに対応 | 1 セッションで複数ツールを使用しても Context 上限に到達しにくい |

## 必要環境

- Claude Code 2.1+
- [Codex MCP](https://github.com/openai/codex) 設定済み（`/codex-*` コマンド用）

## インストール

```bash
# marketplace を追加
/plugin marketplace add sd0xdev/sd0x-dev-flow

# プラグインをインストール
/plugin install sd0x-dev-flow@sd0xdev-marketplace
```

## クイックスタート

インストール後、`/project-setup` を実行してプロジェクト環境を自動検出し、プレースホルダーを設定します：

```bash
/project-setup
```

フレームワーク、パッケージマネージャー、データベース、エントリポイント、スクリプトコマンドを検出し、`CLAUDE.md` を更新します。

## 同梱内容

| カテゴリ | 数 | 例 |
|----------|-----|-----|
| コマンド | 47 | `/project-setup`, `/codex-review-fast`, `/verify`, `/next-step` |
| スキル | 31 | project-setup, code-explore, next-step, skill-health-check |
| エージェント | 14 | strict-reviewer, verify-app, coverage-analyst |
| フック | 5 | pre-edit-guard, auto-format, review state tracking, stop guard, namespace hint |
| ルール | 10 | auto-loop, codex-invocation, security, testing, git-workflow |
| スクリプト | 4 | precommit runner, verify runner, dep audit, namespace hint |

## ワークフロー

### Auto-Loop：Edit → Review → Gate

コアの実行エンジンです。コード編集後、Claude は**自動的に**同じ返答内でレビューを開始します。手動操作は不要です。すべての Gate を通過するまで、Hook が停止をブロックします。

```mermaid
sequenceDiagram
    participant D as 開発者
    participant C as Claude
    participant X as Codex MCP
    participant H as Hooks

    D->>C: コード編集
    H->>H: ファイル変更を追跡
    C->>X: /codex-review-fast（自動）
    X-->>C: P0/P1 検出

    alt 問題あり
        C->>C: すべての問題を修正
        C->>X: --continue threadId
        X-->>C: 再検証
    end

    X-->>C: ✅ Ready
    C->>C: /precommit（自動）
    C-->>D: ✅ すべての Gate 通過

    Note over H: stop-guard が review +<br/>precommit 通過まで停止をブロック
```

### プランニングチェーン

対立型ブレインストーミングで Claude + Codex が独立調査と複数ラウンドの議論を経てナッシュ均衡に到達し、構造化された計画フェーズへ移行します。

```mermaid
flowchart LR
    A["/codex-brainstorm<br/>ナッシュ均衡"] --> B["/feasibility-study"]
    B --> C["/tech-spec"]
    C --> D["/codex-architect"]
    D --> E["実装準備完了"]
```

### ワークタイプ別トラック

```mermaid
flowchart TD
    subgraph feat ["機能開発"]
        F1["/feature-dev"] --> F2["コード + テスト"]
        F2 --> F3["/verify"]
        F3 --> F4["/codex-review-fast"]
        F4 --> F5["/precommit"]
        F5 --> F6["/update-docs"]
    end

    subgraph fix ["バグ修正"]
        B1["/issue-analyze"] --> B2["/bug-fix"]
        B2 --> B3["修正 + 回帰テスト"]
        B3 --> B4["/verify"]
        B4 --> B5["/codex-review-fast"]
        B5 --> B6["/precommit"]
    end

    subgraph docs ["ドキュメントのみ"]
        D1[".md を編集"] --> D2["/codex-review-doc"]
        D2 --> D3["完了"]
    end
```

### 運用ガバナンス

```mermaid
flowchart TD
    S["/project-setup"] --> R["/repo-intake"]
    R --> DEV["開発"]
    DEV --> A["/project-audit<br/>ヘルススコア"]
    DEV --> RA["/risk-assess<br/>破壊的変更"]
    A --> N["/next-step"]
    RA --> N
    N --> |"--go"|AUTO["自動ディスパッチ"]
```

### 全体像

```mermaid
flowchart LR
    P["計画"] --> B["構築"]
    B --> G["ゲート"]
    G --> S["出荷"]

    P -.- P1["/codex-brainstorm<br/>/feasibility-study<br/>/tech-spec"]
    B -.- B1["/feature-dev<br/>/bug-fix<br/>/codex-implement"]
    G -.- G1["/codex-review-fast<br/>/precommit<br/>/codex-test-review"]
    S -.- S1["/pr-review<br/>/update-docs"]
```

### ワークフロー一覧

| ワークフロー | トリガー | 主要コマンド | Gate | 実行レイヤー |
|-------------|----------|-------------|------|-------------|
| 機能開発 | 手動 | `/feature-dev` → `/verify` → `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook + 動作レイヤー |
| バグ修正 | 手動 | `/issue-analyze` → `/bug-fix` → `/verify` → `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook + 動作レイヤー |
| Auto-Loop レビュー | コード編集 | `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook |
| ドキュメントレビュー | `.md` 編集 | `/codex-review-doc` | ✅/⛔ | Hook |
| ドキュメント同期 | Precommit 通過 | `/update-docs` → `/create-request --update` | ✅/⚠️ | 動作レイヤー |
| プランニング | 手動 | `/codex-brainstorm` → `/feasibility-study` → `/tech-spec` | — | — |
| リスク評価 | 手動 | `/project-audit` → `/risk-assess` | ✅/⛔ | — |
| オンボーディング | 初回利用 | `/project-setup` → `/repo-intake` → `/install-rules` | — | — |

## コマンドリファレンス

### 開発

| コマンド | 説明 |
|----------|------|
| `/project-setup` | プロジェクトの自動検出・設定 |
| `/repo-intake` | プロジェクト初回スキャン（1回のみ） |
| `/install-rules` | プラグインルールを `.claude/rules/` にインストール |
| `/install-hooks` | プラグイン hooks を `.claude/` にインストール |
| `/bug-fix` | バグ/Issue 修正ワークフロー |
| `/codex-implement` | Codex がコードを書く |
| `/codex-architect` | アーキテクチャ相談（第三の頭脳） |
| `/code-explore` | コードベースの高速探索 |
| `/git-investigate` | コード変更履歴の追跡 |
| `/issue-analyze` | Issue の深堀り分析 |
| `/post-dev-test` | 開発後のテスト補完 |
| `/feature-dev` | 機能開発ワークフロー（設計 → 実装 → 検証 → レビュー） |
| `/feature-verify` | システム診断（読み取り専用の検証、デュアル視点確認） |
| `/code-investigate` | デュアル視点コード調査（Claude + Codex 独立探索） |
| `/next-step` | コンテキスト認識型の次ステップアドバイザー |

### レビュー（Codex MCP）

| コマンド | 説明 | ループ対応 |
|----------|------|------------|
| `/codex-review-fast` | クイックレビュー（diff のみ） | `--continue <threadId>` |
| `/codex-review` | フルレビュー（lint + build） | `--continue <threadId>` |
| `/codex-review-branch` | ブランチ全体のレビュー | - |
| `/codex-cli-review` | CLI レビュー（ディスク全読み取り） | - |
| `/codex-review-doc` | ドキュメントレビュー | `--continue <threadId>` |
| `/codex-security` | OWASP Top 10 監査 | `--continue <threadId>` |
| `/codex-test-gen` | ユニットテスト生成 | - |
| `/codex-test-review` | テストカバレッジレビュー | `--continue <threadId>` |
| `/codex-explain` | 複雑なコードの解説 | - |

### 検証

| コマンド | 説明 |
|----------|------|
| `/verify` | lint -> typecheck -> unit -> integration -> e2e |
| `/precommit` | lint:fix -> build -> test:unit |
| `/precommit-fast` | lint:fix -> test:unit |
| `/dep-audit` | 依存パッケージのセキュリティ監査 |
| `/project-audit` | プロジェクトヘルス監査（決定論的スコアリング） |
| `/risk-assess` | 未コミットコードのリスク評価 |

### プランニング

| コマンド | 説明 |
|----------|------|
| `/codex-brainstorm` | 対立型ブレスト（ナッシュ均衡まで議論） |
| `/feasibility-study` | フィージビリティ分析 |
| `/tech-spec` | 技術仕様書の作成 |
| `/review-spec` | 技術仕様書のレビュー |
| `/deep-analyze` | 深堀り分析 + ロードマップ |
| `/project-brief` | PM/CTO 向けエグゼクティブサマリー |

### ドキュメント・ツール

| コマンド | 説明 |
|----------|------|
| `/update-docs` | ドキュメントとコードの同期 |
| `/check-coverage` | テストカバレッジ分析 |
| `/create-request` | 要件ドキュメントの作成/更新 |
| `/doc-refactor` | ドキュメントの簡素化 |
| `/simplify` | コードの簡素化 |
| `/de-ai-flavor` | AI 生成の痕跡を除去 |
| `/create-skill` | 新しいスキルの作成 |
| `/pr-review` | PR セルフレビュー |
| `/skill-health-check` | スキル品質とルーティングの検証 |
| `/claude-health` | Claude Code 設定のヘルスチェック |
| `/zh-tw` | 繁体字中国語に書き換え |

## ルール

| ルール | 説明 |
|--------|------|
| `auto-loop` | 修正 -> 再レビュー -> 修正 -> ... -> Pass（自動サイクル） |
| `codex-invocation` | Codex は独立調査必須、結論の注入禁止 |
| `fix-all-issues` | ゼロトレランス：見つけた問題はすべて修正 |
| `framework` | フレームワーク固有の規約（カスタマイズ可） |
| `testing` | Unit/Integration/E2E の分離 |
| `security` | OWASP Top 10 チェックリスト |
| `git-workflow` | ブランチ命名・コミット規約 |
| `docs-writing` | テーブル > 段落、Mermaid > テキスト |
| `docs-numbering` | ドキュメント接頭辞規約（0-feasibility, 2-spec） |
| `logging` | 構造化 JSON、シークレット禁止 |

## フック

| フック | トリガー | 用途 |
|--------|----------|------|
| `namespace-hint` | SessionStart | プラグインコマンドの名前空間ガイダンスを Claude context に注入 |
| `post-edit-format` | Edit/Write 後 | 自動 prettier + 編集時にレビュー状態をリセット |
| `post-tool-review-state` | Bash / MCP ツール後 | レビュー状態の追跡（sentinel ルーティング、名前空間コマンド対応） |
| `pre-edit-guard` | Edit/Write 前 | .env/.git の編集を防止 |
| `stop-guard` | 停止前 | 未完了レビュー時に警告 + stale-state git チェック（デフォルト：warn） |

### フック設定

フックはデフォルトで安全です。環境変数で挙動をカスタマイズ：

| 変数 | デフォルト | 説明 |
|------|------------|------|
| `STOP_GUARD_MODE` | `warn` | `strict` にするとレビュー手順不足時に停止をブロック |
| `HOOK_NO_FORMAT` | （未設定） | `1` で自動フォーマットを無効化 |
| `HOOK_BYPASS` | （未設定） | `1` で stop-guard チェックをすべてスキップ |
| `HOOK_DEBUG` | （未設定） | `1` でデバッグ情報を出力 |
| `GUARD_EXTRA_PATTERNS` | （未設定） | 追加で保護するパスの正規表現（例：`src/locales/.*\.json$`） |

**依存関係**：フックには `jq` が必要です。自動フォーマットにはプロジェクトに `prettier` が必要です。未導入の場合は自動的にスキップされます。

## カスタマイズ

`/project-setup` ですべてのプレースホルダーを自動検出・設定するか、`CLAUDE.md` を直接編集：

| プレースホルダー | 説明 | 例 |
|------------------|------|----|
| `{PROJECT_NAME}` | プロジェクト名 | my-app |
| `{FRAMEWORK}` | フレームワーク | MidwayJS 3.x, NestJS, Express |
| `{CONFIG_FILE}` | メイン設定ファイル | src/configuration.ts |
| `{BOOTSTRAP_FILE}` | ブートストラップエントリ | bootstrap.js, main.ts |
| `{DATABASE}` | データベース | MongoDB, PostgreSQL |
| `{TEST_COMMAND}` | テストコマンド | yarn test:unit |
| `{LINT_FIX_COMMAND}` | Lint 自動修正 | yarn lint:fix |
| `{BUILD_COMMAND}` | ビルドコマンド | yarn build |
| `{TYPECHECK_COMMAND}` | 型チェック | yarn typecheck |

## アーキテクチャ

```
コマンド（入口）-> スキル（機能）-> エージェント（実行環境）
```

- **コマンド**：ユーザーが `/...` で起動
- **スキル**：オンデマンドで読み込まれるナレッジベース
- **エージェント**：専用ツールを持つ隔離されたサブエージェント
- **フック**：自動ガードレール（フォーマット、レビュー状態、ストップガード）
- **ルール**：常時有効な規約（自動読み込み）
- **スクリプト**：検証コマンド用のオプション高速化スクリプト（下記参照）

### スクリプトフォールバック

検証コマンド（`/precommit`、`/verify`、`/dep-audit`）は **Try → Fallback** パターンを採用しています：

1. **Try**：プロジェクトルートにランナースクリプト（`scripts/precommit-runner.js` など）が存在する場合、それを実行して高速かつ再現性のある結果を得ます。
2. **Fallback**：スクリプトが存在しない場合、Claude がプロジェクトのエコシステム（Node.js、Python、Rust、Go、Java）を自動検出し、適切なコマンドを直接実行します。

Fallback はセットアップ不要でそのまま使えます。ランナースクリプトは本プラグインに同梱されていますが、[Claude Code の既知の制限](https://github.com/anthropics/claude-code/issues/9354)（`${CLAUDE_PLUGIN_ROOT}` がコマンド markdown で利用不可）により、プラグインコマンドからスクリプトパスを自動解決できません。上流の問題が解決され次第更新予定です。

## コントリビュート

PR 歓迎です。お願い事項：

1. 既存の命名規約に従う（kebab-case）
2. スキルに `When to Use` / `When NOT to Use` を含める
3. 危険な操作には `disable-model-invocation: true` を付与
4. 提出前に Claude Code でテスト

## ライセンス

MIT
