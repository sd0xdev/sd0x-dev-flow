# sd0x-dev-flow

**语言**: [English](README.md) | [繁體中文](README.zh-TW.md) | 简体中文 | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md)

[Claude Code](https://claude.com/claude-code) 开发工作流插件，可选集成 Codex MCP。

90+ 个工具，覆盖代码审查、测试、问题排查、安全审计与 DevOps 自动化。

## 极小的 Context 占用

本插件仅占用 Claude 200k Context Window 的 **~4%**，同时提供 90+ 个工具——这是核心架构优势。

| 组件 | Tokens | 占 200k 比例 |
|------|--------|-------------|
| Rules（常驻加载） | 5.1k | 2.6% |
| Skills（按需加载） | 1.9k | 1.0% |
| Agents | 791 | 0.4% |
| **合计** | **~8k** | **~4%** |

为什么这很重要：

| 优势 | 说明 |
|------|------|
| 为代码留出更多空间 | 96% 的 Context 留给你的项目文件、diff 和对话 |
| 不影响性能 | 插件开销极低，Claude 响应速度不受影响 |
| Skills 按需加载 | 只有执行的 Skill 才会加载，闲置 Skill 不占用任何 Token |
| 应对复杂场景 | 单次对话可使用多个工具，不易触及 Context 上限 |

## 环境要求

- Claude Code 2.1+
- [Codex MCP](https://github.com/openai/codex) 已配置（用于 `/codex-*` 命令）

## 安装

```bash
# 添加 marketplace
/plugin marketplace add sd0xdev/sd0x-dev-flow

# 安装插件
/plugin install sd0x-dev-flow@sd0xdev-marketplace
```

## 快速开始

安装完成后，运行 `/project-setup` 自动检测项目环境并配置所有占位符：

```bash
/project-setup
```

会自动检测框架、包管理器、数据库、入口文件和脚本命令，然后更新 `CLAUDE.md`。

## 包含内容

| 类别 | 数量 | 示例 |
|------|------|------|
| 命令 | 47 | `/project-setup`, `/codex-review-fast`, `/verify`, `/next-step` |
| 技能 | 31 | project-setup, code-explore, next-step, skill-health-check |
| 代理 | 14 | strict-reviewer, verify-app, coverage-analyst |
| 钩子 | 5 | pre-edit-guard, auto-format, review state tracking, stop guard, namespace hint |
| 规则 | 10 | auto-loop, codex-invocation, security, testing, git-workflow |
| 脚本 | 4 | precommit runner, verify runner, dep audit, namespace hint |

## 工作流

### Auto-Loop：Edit → Review → Gate

核心执行引擎。任何代码编辑后，Claude **自动**在同一回复中触发 review——无需手动操作。Hooks 在所有 gate 通过前阻止停止。

```mermaid
sequenceDiagram
    participant D as 开发者
    participant C as Claude
    participant X as Codex MCP
    participant H as Hooks

    D->>C: 编辑代码
    H->>H: 跟踪文件变更
    C->>X: /codex-review-fast（自动）
    X-->>C: P0/P1 发现

    alt 发现问题
        C->>C: 修复所有问题
        C->>X: --continue threadId
        X-->>C: 重新验证
    end

    X-->>C: ✅ Ready
    C->>C: /precommit（自动）
    C-->>D: ✅ 所有 gate 通过

    Note over H: stop-guard 在 review +<br/>precommit 通过前阻止停止
```

### 规划链

对抗式头脑风暴通过 Claude + Codex 独立研究与多轮辩论达成纳什均衡，随后进入结构化规划。

```mermaid
flowchart LR
    A["/codex-brainstorm<br/>纳什均衡"] --> B["/feasibility-study"]
    B --> C["/tech-spec"]
    C --> D["/codex-architect"]
    D --> E["准备实现"]
```

### 工作类型路径

```mermaid
flowchart TD
    subgraph feat ["功能开发"]
        F1["/feature-dev"] --> F2["编写代码 + 测试"]
        F2 --> F3["/verify"]
        F3 --> F4["/codex-review-fast"]
        F4 --> F5["/precommit"]
        F5 --> F6["/update-docs"]
    end

    subgraph fix ["缺陷修复"]
        B1["/issue-analyze"] --> B2["/bug-fix"]
        B2 --> B3["修复 + 回归测试"]
        B3 --> B4["/verify"]
        B4 --> B5["/codex-review-fast"]
        B5 --> B6["/precommit"]
    end

    subgraph docs ["纯文档"]
        D1["编辑 .md"] --> D2["/codex-review-doc"]
        D2 --> D3["完成"]
    end
```

### 运维治理

```mermaid
flowchart TD
    S["/project-setup"] --> R["/repo-intake"]
    R --> DEV["开发"]
    DEV --> A["/project-audit<br/>健康评分"]
    DEV --> RA["/risk-assess<br/>破坏性变更"]
    A --> N["/next-step"]
    RA --> N
    N --> |"--go"|AUTO["自动分派"]
```

### 全局一览

```mermaid
flowchart LR
    P["规划"] --> B["构建"]
    B --> G["关卡"]
    G --> S["交付"]

    P -.- P1["/codex-brainstorm<br/>/feasibility-study<br/>/tech-spec"]
    B -.- B1["/feature-dev<br/>/bug-fix<br/>/codex-implement"]
    G -.- G1["/codex-review-fast<br/>/precommit<br/>/codex-test-review"]
    S -.- S1["/pr-review<br/>/update-docs"]
```

### 工作流目录

| 工作流 | 触发方式 | 主要命令 | Gate | 执行层 |
|--------|----------|----------|------|--------|
| 功能开发 | 手动 | `/feature-dev` → `/verify` → `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook + 行为层 |
| 缺陷修复 | 手动 | `/issue-analyze` → `/bug-fix` → `/verify` → `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook + 行为层 |
| Auto-Loop 审查 | 代码编辑 | `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook |
| 文档审查 | `.md` 编辑 | `/codex-review-doc` | ✅/⛔ | Hook |
| 文档同步 | Precommit 通过 | `/update-docs` → `/create-request --update` | ✅/⚠️ | 行为层 |
| 规划 | 手动 | `/codex-brainstorm` → `/feasibility-study` → `/tech-spec` | — | — |
| 风险评估 | 手动 | `/project-audit` → `/risk-assess` | ✅/⛔ | — |
| 入门引导 | 首次使用 | `/project-setup` → `/repo-intake` → `/install-rules` | — | — |

## 命令参考

### 开发

| 命令 | 说明 |
|------|------|
| `/project-setup` | 自动检测并配置项目 |
| `/repo-intake` | 一次性项目盘点扫描 |
| `/install-rules` | 安装插件规则到 `.claude/rules/` |
| `/install-hooks` | 安装插件 hooks 到 `.claude/` |
| `/bug-fix` | 缺陷修复工作流 |
| `/codex-implement` | Codex 编写代码 |
| `/codex-architect` | 架构建议（第三大脑） |
| `/code-explore` | 快速代码探索 |
| `/git-investigate` | 追踪代码历史 |
| `/issue-analyze` | 深度问题分析 |
| `/post-dev-test` | 开发后补充测试 |
| `/feature-dev` | 功能开发流程（设计 → 实现 → 验证 → 审查） |
| `/feature-verify` | 系统诊断（只读验证，双视角确认） |
| `/code-investigate` | 双视角代码调查（Claude + Codex 独立探索） |
| `/next-step` | 情境感知的下一步建议 |

### 审查（Codex MCP）

| 命令 | 说明 | 循环支持 |
|------|------|----------|
| `/codex-review-fast` | 快速审查（仅 diff） | `--continue <threadId>` |
| `/codex-review` | 完整审查（lint + build） | `--continue <threadId>` |
| `/codex-review-branch` | 完整分支审查 | - |
| `/codex-cli-review` | CLI 审查（全盘读取） | - |
| `/codex-review-doc` | 文档审查 | `--continue <threadId>` |
| `/codex-security` | OWASP Top 10 审计 | `--continue <threadId>` |
| `/codex-test-gen` | 生成单元测试 | - |
| `/codex-test-review` | 审查测试覆盖率 | `--continue <threadId>` |
| `/codex-explain` | 解释复杂代码 | - |

### 验证

| 命令 | 说明 |
|------|------|
| `/verify` | lint -> typecheck -> unit -> integration -> e2e |
| `/precommit` | lint:fix -> build -> test:unit |
| `/precommit-fast` | lint:fix -> test:unit |
| `/dep-audit` | 依赖安全审计 |
| `/project-audit` | 项目健康审计（确定性评分） |
| `/risk-assess` | 未提交代码风险评估 |

### 规划

| 命令 | 说明 |
|------|------|
| `/codex-brainstorm` | 对抗式头脑风暴（纳什均衡） |
| `/feasibility-study` | 可行性分析 |
| `/tech-spec` | 生成技术规格书 |
| `/review-spec` | 审查技术规格书 |
| `/deep-analyze` | 深度分析 + 路线图 |
| `/project-brief` | PM/CTO 执行摘要 |

### 文档与工具

| 命令 | 说明 |
|------|------|
| `/update-docs` | 同步文档与代码 |
| `/check-coverage` | 测试覆盖率分析 |
| `/create-request` | 创建/更新需求文档 |
| `/doc-refactor` | 精简文档 |
| `/simplify` | 代码精简 |
| `/de-ai-flavor` | 去除 AI 痕迹 |
| `/create-skill` | 创建新技能 |
| `/pr-review` | PR 自查 |
| `/skill-health-check` | 验证 Skill 质量与 routing |
| `/claude-health` | Claude Code 配置健康检查 |
| `/zh-tw` | 改写为繁体中文 |

## 规则

| 规则 | 说明 |
|------|------|
| `auto-loop` | 修复 -> 重新审查 -> 修复 -> ... -> 通过（自动循环） |
| `codex-invocation` | Codex 必须自主调研，禁止喂结论 |
| `fix-all-issues` | 零容忍：修复所有发现的问题 |
| `framework` | 框架专属规范（可自定义） |
| `testing` | 单元/集成/端到端测试隔离 |
| `security` | OWASP Top 10 检查清单 |
| `git-workflow` | 分支命名、提交规范 |
| `docs-writing` | 表格 > 段落，Mermaid > 文字 |
| `docs-numbering` | 文档前缀规范（0-feasibility, 2-spec） |
| `logging` | 结构化 JSON，禁止泄露敏感信息 |

## 钩子

| 钩子 | 触发时机 | 用途 |
|------|----------|------|
| `namespace-hint` | SessionStart | 在 Claude context 中注入插件命令命名空间指引 |
| `post-edit-format` | 编辑/写入之后 | 自动格式化 + 编辑后重置审查状态 |
| `post-tool-review-state` | Bash / MCP 工具之后 | 追踪审查状态（sentinel 路由，支持命名空间命令） |
| `pre-edit-guard` | 编辑/写入之前 | 禁止编辑 .env/.git |
| `stop-guard` | 停止之前 | 未完成审查时告警 + stale-state git 检查（默认：warn） |

### 钩子配置

钩子默认安全。通过环境变量自定义行为：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STOP_GUARD_MODE` | `warn` | 设为 `strict` 可在缺少审查步骤时阻止停止 |
| `HOOK_NO_FORMAT` | （未设置） | 设为 `1` 禁用自动格式化 |
| `HOOK_BYPASS` | （未设置） | 设为 `1` 跳过所有停止守卫检查 |
| `HOOK_DEBUG` | （未设置） | 设为 `1` 输出调试信息 |
| `GUARD_EXTRA_PATTERNS` | （未设置） | 额外保护路径的正则表达式（例如 `src/locales/.*\.json$`） |

**依赖**：钩子需要 `jq`。自动格式化需要项目已装 `prettier`。缺少依赖时会自动跳过。

## 自定义配置

运行 `/project-setup` 自动检测并配置所有占位符，或手动编辑 `CLAUDE.md`：

| 占位符 | 说明 | 示例 |
|--------|------|------|
| `{PROJECT_NAME}` | 项目名称 | my-app |
| `{FRAMEWORK}` | 框架 | MidwayJS 3.x, NestJS, Express |
| `{CONFIG_FILE}` | 主配置文件 | src/configuration.ts |
| `{BOOTSTRAP_FILE}` | 启动入口 | bootstrap.js, main.ts |
| `{DATABASE}` | 数据库 | MongoDB, PostgreSQL |
| `{TEST_COMMAND}` | 测试命令 | yarn test:unit |
| `{LINT_FIX_COMMAND}` | Lint 自动修复 | yarn lint:fix |
| `{BUILD_COMMAND}` | 构建命令 | yarn build |
| `{TYPECHECK_COMMAND}` | 类型检查 | yarn typecheck |

## 架构

```
命令（入口）-> 技能（能力）-> 代理（环境）
```

- **命令**：用户通过 `/...` 触发
- **技能**：按需加载的知识库
- **代理**：拥有特定工具的隔离子代理
- **钩子**：自动化防护栏（格式化、审查状态、停止守卫）
- **规则**：始终生效的规范（自动加载）
- **脚本**：验证命令的可选加速脚本（见下方说明）

### 脚本回退机制

验证命令（`/precommit`、`/verify`、`/dep-audit`）采用 **Try → Fallback** 模式：

1. **Try**：如果项目根目录存在 runner 脚本（`scripts/precommit-runner.js` 等），直接执行以获得快速、确定性的结果。
2. **Fallback**：如果脚本不存在，Claude 会自动检测项目生态系统（Node.js、Python、Rust、Go、Java）并直接运行相应命令。

Fallback 开箱即用，无需任何配置。Runner 脚本虽然包含在本插件中，但由于 [Claude Code 的已知限制](https://github.com/anthropics/claude-code/issues/9354)（`${CLAUDE_PLUGIN_ROOT}` 在命令 markdown 中不可用），目前无法从插件命令中自动解析脚本路径。上游问题修复后将同步更新。

## 贡献

欢迎 PR。请：

1. 遵循现有命名规范（kebab-case）
2. 在技能中包含 `When to Use` / `When NOT to Use`
3. 对危险操作添加 `disable-model-invocation: true`
4. 提交前用 Claude Code 测试

## 许可证

MIT
