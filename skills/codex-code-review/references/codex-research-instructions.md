# Codex Independent Research Instructions

Source-of-truth wording for the independent-research block, for the prompt families that cite it. A
consumer **cites this file and embeds the applicable variant** — it does not link instead of
inlining, because the block has to be present in the prompt that is actually dispatched. Templates
outside these families (`architecture`, `codex-implement`) carry their own research instructions and
do not cite this file.

## Binding a Path Into a Research Command

Every block below renders a repository path — `${FILE_PATH}`, `${SOURCE_PATH}`, `${REQUEST_PATH}` —
into a shell command the reviewer then runs. **A path is data.** Its bytes are whatever the
repository happens to contain — and in the one family whose files were created by the dispatch
itself (`codex-implement`, which carries its own instructions), they are chosen by that dispatch
outright.

So the dispatcher binds a path as a **shell-single-quoted literal**, with any embedded apostrophe
escaped, and the command uses it after a `--` where the tool accepts one:

```bash
grep -rn "import.*from" -- 'path with a $(space) and quote' | head -10
```

Double quotes are **not** the fix, and this was measured rather than assumed:
`$(…)` is still expanded inside them (`draft$(printf injected).md` became `draftinjected.md`).
Single quotes stop expansion outright, which is why they are the form named here.

The templates below write the placeholder bare — `cat ${FILE_PATH}` — because a template cannot
quote what it does not yet hold. Quoting is the **binding step's** job, and stating it once here is
what keeps eight prompt files from each getting it wrong differently.

## Core Principle

**Give direction, not content.** Codex can read the whole repository for itself — full access. Instead of dumping diffs or file contents into the prompt, provide metadata (changed file list, diff stats, file path) and let Codex read the actual content itself. This ensures Codex sees full context, not a truncated slice.

## Standard Research Block (Code Review)

Include this block verbatim in code review prompts (fast, full, branch):

```
## ⚠️ Important: You must independently research the project ⚠️

The changed files and diff stats are listed above. You **must** read the actual diffs and file contents yourself using your sandbox access. Do NOT expect a pre-provided diff — you are responsible for reading all changes in context.

### Git Exploration (Priority)
1. Check change status: `git status`
2. Read the full diff: `git diff HEAD`
3. For each changed file, read the full diff: `git diff HEAD -- <file-path>`
4. Read changed files for context: `cat <changed file>` — read it to the end, in numbered chunks (`sed -n '1,200p'`, `sed -n '201,400p'`, …) when it is long. `head -200` would truncate: files here run past 400 lines and the changed material is routinely below line 200

### Project Research
- Search called functions: `grep -r "functionName" . -l --include="*.ts" --include="*.js" --include="*.md" | head -10`
- Read related files: `cat <file-path> | head -100`
- Understand class definitions: `grep -rA 20 "class ClassName" . --include="*.ts" --include="*.js"`
```

## Variant: Document Review

```
## ⚠️ Important: You must independently read and research the project ⚠️

The document path is provided above. You **must** read the document content and research the project yourself using your sandbox access. Do NOT expect pre-provided file content — you are responsible for reading the document and verifying its accuracy.

### Document Reading (Priority)
1. Read the full document: `cat ${FILE_PATH}`
2. If the document is long: `cat ${FILE_PATH} | head -300` then `cat ${FILE_PATH} | tail -200`

### Code-Documentation Consistency Research
1. Check the project structure by discovering it: `ls` at the repository root, then list the directories it actually shows — do not assume a `src/` or `test/unit/` layout; many repositories, this one included, have neither
2. Search related code: `grep -r "keyword" . -l --include="*.ts" --include="*.js" --include="*.sh" | head -10`
3. Read related files: `cat <file-path> | head -100`
```

## Variant: Security Review

```
## ⚠️ Important: You must independently research the project ⚠️

Security review requires full context. You **must** independently research:

1. `grep -rln "auth\|token\|session" . | head -10` — rooted at the repository, or at a directory discovery surfaced; never an assumed `src/`
2. Request entry points in whatever framework the discovery step showed — e.g. `grep -rn "@Body\|@Query\|@Param\|req\.body\|request\." . | head -50`
3. `grep -rln "password\|secret\|key" .` — rooted at the repository, or at a directory discovery surfaced; never an assumed `src/`
```

## Variant: Test Review / Test Gen

```
## ⚠️ Important: You must independently research the project ⚠️

When reviewing test coverage, you **must** perform the following research:

### Research Steps
1. Check the project structure by discovering it: `ls` at the repository root, then list the directories it actually shows — do not assume a `src/` or `test/unit/` layout; many repositories, this one included, have neither
2. Search related code: `grep -rn "className" . -l | head -10` — rooted at the repository, or at a directory the discovery step above surfaced
3. Read source file: `cat <source path> | head -150`
4. Read an existing test as a convention sample, found rather than assumed: `grep -rln "describe\\|test(" . --include="*test*" | head -5`, then read one
```

## Variant: Plan Review

```
## ⚠️ Important: You must independently research the project ⚠️

The plan is a candidate artifact to attack, not a conclusion to confirm. Before judging it, you
**must** establish what the code actually does today:

### Research Steps
1. Check the areas the plan touches, starting from what exists: `ls` at the repository root, then list the directories it actually shows — do not assume a `src/` or `test/unit/` layout; many repositories, this one included, have neither; then `git status`
2. Read what the plan claims to change: `cat <file the plan names> | head -150`
3. Verify each factual claim the plan makes about existing behaviour — a plan step premised on
   something the code does not do is the finding, not the step that follows it
4. Look for what the plan does NOT mention but its own changes reach: `grep -rn "<symbol>" . -l` — rooted at the repository, not an assumed `src/`
```

## Variant: Code Explanation

```
## ⚠️ Important: You must independently research the project ⚠️

Before explaining code, you **must** independently research:

### Research Steps
1. Check the project structure — list the target file's own directory and the repository root. Do
   not assume a `src/` layout; many repositories, this one included, have none.
2. Trace imports: `grep -rn "import.*from" ${FILE_PATH} | head -10`
3. Read dependencies: `cat <dependency path> | head -100`
4. Find callers: `grep -rn "<symbol>" . --include="<the target's extension>" -l | head -5`, rooted
   at the repository rather than at an assumed source directory
```
