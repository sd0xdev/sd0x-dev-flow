# Pre-Push Gate Opt-In Technical Spec

> **Doc class**: Lifecycle — Phase 2 tech spec (per `@rules/docs-numbering.md`)
> **Created**: 2026-08-21
> **Requests**: [r1](./requests/2026-08-15-push-gate-optin-r1.md) · [r2](./requests/2026-08-15-push-gate-optin-r2.md) · [r3](./requests/2026-08-15-push-gate-optin-r3.md) · [r4](./requests/2026-08-15-push-gate-optin-r4.md) · [r5](./requests/2026-08-20-push-ci-force-with-lease-r5.md)
>
> **Why this document exists, written late.** The four tickets were opened against a settled plan
> and no Phase 2 spec was written, which `@rules/docs-numbering.md` lists as Required. It is
> reconstructed here from the design the tickets and the shipped instruction surfaces already
> agree on. It is **not** a substitute for reading them: the executable contract lives in
> `skills/codex-setup/SKILL.md`, `skills/push-ci/SKILL.md` and `rules/git-workflow.md`, and where
> this document and those disagree, **they are authoritative and this one is stale**.
> [`4-implementation.md`](./4-implementation.md) is a different document again — it records two
> guard-construction lessons (the formatter's write target, and what a closing grep can prove),
> not this design.

## 1. Requirement Summary

- **Problem**: `/codex-setup` Phase 3 installed both `commit-msg` and `pre-push` unconditionally.
  The user asked for `pre-push` to be off by default and installed only on request.
- **Why it is not a one-line change**: `/codex-setup` has three subcommands, and two of them
  independently undo an opt-out — `doctor` reported a deliberately-absent hook as a broken install,
  and `sync` reinstalled it without any new request. Opt-in therefore has to be defined as a
  **state machine**, not as a condition on the install step.
- **Second requirement, discovered with it**: once the gate can be absent, the rules that named it
  the terminal push credential describe a mechanism that may not exist. The authorization contract
  has to say what authorizes a push **when the hook is not installed**.

| Scope | |
| ----- | --- |
| In | `/codex-setup` init/sync/doctor/state; `scripts/pre-push-gate.sh`; the authorization contract in `rules/git-workflow.md`, `rules/discretion.md` § Efficacy Boundary, `skills/push-ci/SKILL.md`; downstream restatements (README, cookbook, other feature docs) |
| Out | `/install-scripts`, which copies scripts and has never wired a hook — the repo claimed otherwise in several places, and correcting those claims is r1/r3 work, not a behaviour change |

## 2. Design

### 2.1 The state machine

`install-state.json` records a **status per hook**, never the absence of a field — "not installed"
and "deliberately not installed" must be distinguishable, and a missing key cannot carry that
distinction:

| Status | Meaning |
| ------ | ------- |
| `installed` | wired, and git resolves to it |
| `declined` | deliberately not installed — the opt-out itself, recorded |
| `pending` | written to disk but **not active**; git does not resolve to it, so nothing fires |
| absent key (`unknown`) | the state file pre-dates this contract; resolve from disk and record what was resolved |

Transitions, one row per path that could otherwise undo the opt-out:

| Path | `--with-push-gate` | Behaviour |
| ---- | ------------------ | --------- |
| `init` | not passed | install `commit-msg`; for `pre-push` **read the recorded status first, then the disk** — `installed` (wiring present or absent) → re-copy/re-install and keep `installed`; `unknown` × wiring present → refresh and record `installed`; `unknown` × absent → `declined` and print the skip line; `declined` → leave declined. **"Skipped" is not "declined"** |
| `init` | passed | install both; record what § 2.2's activation test answers — `installed` when git resolves to the hook, `pending` with its mode when it does not. The flag decides whether the gate is installed, never what status is written |
| `init` | either | `pending` → re-copy, then **re-resolve activation**: active → `installed`; still not active → leave `pending` and reprint the recorded mode's remedy. Never `declined`: `pending` records an opt-in that happened and a wiring step that did not finish |
| `sync` | not passed | `installed` → re-copy and re-hash, **never remove**; `pending` → the same re-copy and re-resolve as above; `unknown` → resolve from disk by sd0x integration evidence (not container-file existence), then enter the row it resolved to; `declined` → skip, leave declined |
| `sync` | passed | `declined` → install and rewrite the status per the activation test — this is the opt-in path; `unknown` → install and record the same way, without resolving from disk first (that would answer `declined` and silently drop the request) |
| `doctor` | — | evaluate **activation**, not presence (§ 2.2); `declined` × absent is a **pass**, reported as `pre-push: not installed (opt-in)`; `pending` splits on activation — not active → ❌ Fail with the recorded mode's remedy, active → ⚠️ Warn that the record is stale, never a Fail |

**One row per path only where the path has one behaviour.** `init` and `sync` each take two rows
because the flag genuinely changes what they do; the `pending` and `unknown` states then divide
each of those further, which is why the cells above enumerate by recorded status rather than
pretending the flag alone decides. An earlier version of this table listed only `installed` and
`declined`, which read as a closed enumeration and left the two states that actually need a
transition — `pending`, which must be able to resolve, and `unknown`, which must be able to be
resolved — with no path out of them.

Two rules make the machine honest rather than merely stateful: **`sync` updates what is installed
and never changes what was chosen** (reinstalling a declined hook would undo an opt-out by a route
the operator never sees), and **`doctor` lists a declined hook rather than omitting its row** (an
operator who did not expect the opt-out needs to see it; a row that disappears cannot tell them).

### 2.2 Writing a hook file is not installing it

Every mode ends by asking **git's own answer** — `git rev-parse --git-path "hooks/<hook>"` — and
comparing per mode, because the modes differ in what git runs:

**The mode numbers are the install priority numbers, not a second scheme** — mode 1 *is* Husky, so
it takes the Husky row and never the direct-file one. Grouping "1–3" as direct-file while carrying
a separate `Husky` row left two rows claiming mode 1, and a literal reader picking the wrong one
gets an `-ef` comparison that reports a fully active Husky chain as inactive.

| Mode | Active ⇔ |
| ---- | -------- |
| 1 (Husky) | `resolved` is Husky's shim and it still reaches the container carrying the sd0x stanza |
| 2 (`core.hooksPath` set) | `resolved` is the written path |
| 3 (`.git/hooks/` direct) | same test |
| 4 (fallback `.githooks/`) | same test; false while `core.hooksPath` is unset |

Inactive is `pending` in **every** mode, never only mode 4 — what differs per mode is the remedy
reported alongside it, which is why `mode` is recorded next to `status`.

Husky is why an `-ef` test alone is wrong: `core.hooksPath=.husky/_` means git runs a Husky shim
that *sources* `.husky/<hook>`, two different files, so the naive test reports an active chain as
inactive. And the `.githooks` remedy belongs to mode 4 only — printing it for Husky would abandon
`.husky/_` and stop **every** Husky hook, a wider break than the one being reported.

### 2.3 The authorization contract

> ⚠️ **部分已被取代（2026-08-21，option A）** — 本節下方「exactly one class」及其矩陣記載的是
> 撰寫當時的設計判讀。hook 現在提示**兩類**；差異逐條記於檔末補記。本檔經
> `scripts/lib/doc-metadata.js` 判定為 **Design record**（`owesCodeAlignment` 為 `false`），
> 故原文一字不動，只在宣稱當下給出指標——現行行為以 `rules/git-workflow.md` § Push safety
> 與 `scripts/pre-push-gate.sh` 為準。

Which credential authorizes a push depends on whether the gate is installed **and on what the push
is**. The hook prompts on exactly one class: a ref set including a protected branch with
`ALLOW_PUSH_PROTECTED` unset.

| Situation | Terminal credential |
| --------- | ------------------- |
| Hook installed, push is that class | `pre-push-gate.sh` over `/dev/tty`; `/push-ci`'s AskUserQuestion is advisory |
| Hook installed, hook exits 0 without prompting | `/push-ci`'s AskUserQuestion **is** the authorization |
| Hook not installed | same — there is no stronger mechanism to defer to |
| Non-fast-forward, `ALLOW_FORCE_WITH_LEASE` unset, **force-form** push | **Refused by the hook** — git supplies the ref, the hook's ancestry check fails and it exits 1 before any credential is selected |
| Non-fast-forward, `ALLOW_FORCE_WITH_LEASE` unset, **flagless** push | **Refused by git**, client-side, before the hook runs. git withholds a ref it has already rejected, so the hook receives an empty ref list and exits 0 having refused nothing — the `[rejected] … (non-fast-forward)` is git's, not the gate's. Pinned in `test/scripts/pre-push-gate.test.js` (`REFLINES:0` vs `REFLINES:1`) |
| Non-fast-forward, variable set | Not a class of its own — it falls through to the protected decision above, so a *protected* non-fast-forward push still reaches `/dev/tty` |

Both refusal rows reach the same place by different mechanisms: the push does not happen, so
nothing authorized anything. Which mechanism refused still matters, because attributing the
flagless case to the gate credits a guard for a rejection it never saw — and an operator who
believes the gate covers flagless divergence will expect a refusal from a hook that is not
installed.

The asymmetry is deliberate and load-bearing: AskUserQuestion may be auto-approved by session
caching, so it is never the sole credential for an action **beyond** the enumerated workflows — but
inside a workflow that names no stronger mechanism it remains required and sufficient. Treating an
absent gate as a reason to push unasked would turn opting out of a *confirmation* into opting out
of *approval*. The normative text is `rules/discretion.md` § Efficacy Boundary, byte-pinned by
`test/rules/discretion-tiers.test.js`; that pin, not this section, is the authority.

### 2.4 Atomic publication

r2, r3 and r4 must land in one batch. Split, every ordering leaves an inconsistent intermediate
state: r2 first removes the hook by default while the rules still call it the terminal credential;
r3 first announces opt-in in README while the installer still installs unconditionally. This is an
**atomicity** constraint, not an ordering one, which is why the tickets carry no `Depends On`.

> ⚠️ **Already violated at `HEAD`.** Commit `2692ede` (2026-08-16) published README's
> `--with-push-gate` interface with no installer behind it —
> `git show HEAD:skills/codex-setup/SKILL.md | grep -c -- '--with-push-gate'` → 0. The remaining
> work therefore reconciles a published inconsistency rather than preventing one. See
> [review-log-push-gate-optin.md](./review-log-push-gate-optin.md) § 原子發佈集破功的查證.

## 3. Risks

| Risk | Mitigation |
| ---- | ---------- |
| Upgrading an existing project silently removes an installed gate | `sync` never removes; the flag's absence is not an uninstall request |
| A repo passes `doctor` with a gate git never runs | § 2.2 — activation, not presence |
| A rule names a credential that is not installed | § 2.3 states the disjunction rather than assuming one branch |
| The `--force-with-lease` grant widens an Anchor exception list | **Open — see r5.** No durable approval artifact exists in the repository; r5's ACs stay unchecked until one does |

## 4. Testing Strategy

Per `@rules/testing.md`. Three things this feature's tests must hold, each because it failed once:

- **State transitions are the unit**, not the install step: `init` without/with the flag, `sync` in
  both states, `doctor` in both states, plus `unknown` → opt-in and uninstall.
- **Guards ship with a negative control.** The `doctor` activation check is the worked example: a
  test that only asserts the pass row cannot tell activation from presence, so it also asserts that
  reverting to bare presence turns red.
- **Authorization-bearing documents are digest-pinned** (`skills/push-ci/SKILL.md`,
  `skills/smart-rebase/SKILL.md`). The pin is a review reminder, not a hash gate: it fires on any
  edit so a human reads the diff and confirms it moves neither what may be executed nor what
  approval is required.

## 5. Open Questions

1. ~~**`pending` has no transition out of it.**~~ **Resolved 2026-08-21.** `init` (Phase 3) and
   `sync` each gained a `pending` row that re-copies and then **re-resolves activation** — active
   → `installed`, still not active → stays `pending` with the recorded mode's remedy reprinted —
   and `doctor` now splits `pending` by activation instead of failing it unconditionally
   (`pending` × active is ⚠️, not ❌: the remedy worked and the gate fires; only the state file is
   stale). Pinned by `test/skills/codex-setup.test.js`. The state was writable with no exit, so an
   operator who ran the printed remedy was left recorded as broken forever — a defect the state
   table could not show, because every state in it looked individually well-defined.
2. **`/push-ci` permits `--force-with-lease` on branches `rules/git-workflow.md` calls "shared".**
   The rule forbids force-pushing shared branches; the grant does not carve out that overlap.
3. **The r5 grant lacks a durable attestation** — § 3's last row. Until that exists, this document
   describes the grant without asserting it is established.

---

> **補記（2026-08-21，option A 落地後）——本節不改寫原文，僅記錄哪些敘述已被取代。**
>
> 本檔是 **Design record**（`scripts/lib/doc-metadata.js` `BUILTIN_ROLE_CONFIG.path_defaults`），
> 記載的是當時的設計判讀，因此上文一字未動。以下兩處自 2026-08-21 起**不再描述現行行為**：
>
> | 原文敘述 | 現況 |
> |---|---|
> | 「The hook prompts on exactly one class」及其對應矩陣（無「非 protected force push」這一列） | hook 現在提示**兩類**：protected 分支（`ALLOW_PUSH_PROTECTED` 未設），以及**實際改寫歷史**的 push（`ALLOW_FORCE_UNSHARED` 未設），後者涵蓋前者未涵蓋的被改寫 ref。權威敘述在 `rules/git-workflow.md` § Push safety |
> | § 5 Open Question：共用 feature branch 的界線、擴權的持久核准 | 兩題皆已由使用者於 2026-08-21 以 AskUserQuestion 裁示（選項 A／核准保留），逐字轉錄見 [`requests/2026-08-20-push-ci-force-with-lease-r5.md`](./requests/2026-08-20-push-ci-force-with-lease-r5.md) § 使用者裁示；機制與論證見 [`./4-implementation.md`](./4-implementation.md) § 3 |
>
> 同時更正本檔前言的一處計數：`4-implementation.md` 現有**四**個頂層編號小節（`§ 1`–`§ 4`），
> 前言寫的「two guard-construction lessons」是 § 3 加入前的數字。**本行原寫「三」，於 2026-08-21
> round 32 更正為「四」**：§ 4 在補記寫成之後才落地，於是這條「更正一個計數」的補記，被它自己
> 印出的推導指令推翻了同一個計數。教訓寫在這裡而不是刪掉重寫：**印出推導指令的數字會過期，
> 而指令不會**——所以下面那行才是權威，這裡的數字只是撰寫當時的快照。推導：
> `grep -c '^## [0-9]\+\.' docs/features/push-gate-optin/4-implementation.md`
