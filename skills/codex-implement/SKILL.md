---
name: codex-implement
description: "Implement features via Codex exec. Use when: writing new code from specs, implementing features, Codex-driven development. Not for: code review (use codex-code-review), architecture advice (use codex-architect). Output: implemented code + review loop."
allowed-tools: Bash(git:*), Read, Grep, Glob, Edit, Write, AskUserQuestion, Skill, Agent, Bash(node:*)
---

# Codex Implement Skill

## Trigger

- Keywords: codex implement, implement feature, codex write code, implement from spec

## When NOT to Use

- Architecture advice only (use `/codex-architect`)
- Code review (use `/codex-review-fast`)
- Bug fix (use `/bug-fix`)
- Simple one-line change (edit directly)

## Workflow

```
Parse args → Decompose → Collect context → Iterate items → Review loop → Done
                                              ↕
                                    codex → diff → confirm
                                              ↕
                                    reject/modify → § Resume
```

### Step 0: Pre-check and precondition (before any repository read)

**The index must carry no `assume-unchanged` / `skip-worktree` path before anything is dispatched**
— under the two grants this skill holds, `Bash(git:*)` and `Bash(node:*)`, and no others:

```bash
node -e '
  const { execSync } = require("child_process");
  // The REPOSITORY, not the invocation directory. `git ls-files` is path-limited to the cwd
  // subtree, so running this from `skills/` would inspect a fraction of the index and report a
  // clean tree while a flagged file sat elsewhere — and the dispatch runs Codex at the top level
  // regardless of where this skill was invoked.
  const root = execSync("git rev-parse --show-toplevel").toString().trim();
  // `git ls-files -v` tags every cached path. Measured on git 2.55.0: `H` is the ordinary cached
  // entry, `S` is skip-worktree, and `-v` LOWERCASES the tag of an assume-unchanged file — so `h`
  // is assume-unchanged and `s` is both bits. Hidden state is therefore "tag is `S`, or the tag is
  // lowercase"; testing only for lowercase misses plain skip-worktree, and testing for "not `H`"
  // over-triggers on `M`, an unmerged entry, whose remedy is finishing the merge and which neither
  // `--no-assume-unchanged` nor `--no-skip-worktree` would touch.
  const lines = execSync("git ls-files -v", { cwd: root, maxBuffer: 1 << 28 }).toString()
    .split("\n").filter(Boolean);
  const hidden = lines.filter((l) => /^[a-z] /.test(l) || l.startsWith("S "));
  const unmerged = lines.filter((l) => /^[Mm] /.test(l));
  console.log(hidden.length ? hidden.join("\n") : "(none)");
  if (unmerged.length) console.log("[UNMERGED — finish the merge first]\n" + unmerged.join("\n"));
'
```

A hidden-state tag is an `assume-unchanged` or `skip-worktree` bit, and such a path is invisible three
times over: the precondition below cannot see a local edit to it, Step 3b cannot display one, and
Step 3b's Reject would treat it as baseline-absent and run `git checkout -- <path>` — which restores
the *index* version and destroys the edit for good. That is data loss with no recovery path, so it
is a hard stop rather than an opt-out: list the flagged paths, ask the user to clear the bit
(`git update-index --no-assume-unchanged <path>` / `--no-skip-worktree <path>`) or to commit or stash
the work, and re-run this step. **Never auto-revert a tracked path whose prior contents were not
captured** — the Reject row's "no state to lose" holds only for paths the baseline could actually
see.

Then resolve the adapter through `@skills/codex-code-review/references/codex-transport.md`
§ Locator, and let any auto-install that section prescribes happen before the `git status` below —
in a consuming repository its second step *writes* the adapter into the tree, and a write after the
snapshot puts an untracked file there that the changeset this step captured does not contain. Same reason the rest of this step is ordered the way it is: a snapshot that goes stale
while the work runs describes a tree nobody is looking at.

Then `git status --porcelain --untracked-files=all --ignored`, and satisfy the precondition in
§ Step 3a before Step 1 reads anything. Step 1 parses the spec, loads the feature intent and derives the items
from files the precondition may ask the user to stash or remove; running it first leaves the plan —
and later the dispatched prompt — describing a tree that no longer exists. Three review rounds moved
this earlier twice: it began inside Step 3, then before Step 2, and neither was early enough because
each time a reader still hit a repository read first. It is a numbered step so the order is
executable rather than asserted from inside a later one.

If cleanup happens after this step for any other reason, repeat the Step 1 reads and plan
confirmation, and rebind the Step 2 context, before dispatching.

**Then pin the redactor Step 3b will run, by digest, before Codex is dispatched.** Step 3b executes
that module (`require`), and by then the tree has been through a write-capable child — so no check
made *afterwards* can establish what the module was: a child that sets `assume-unchanged` on a
tracked file and then overwrites it leaves `git status` empty, which is exactly the invisibility this
step's own probe exists to catch, and a path swapped for a symlink resolves somewhere else entirely.
Authenticating the **bytes now** and requiring the same bytes later is the only order that works.

```bash
node -e '
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const { execSync, execFileSync } = require("child_process");
  const root = fs.realpathSync(execSync("git rev-parse --show-toplevel").toString().trim());
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  const inside = (p) => p === root || p.startsWith(root + path.sep);
  const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)); } catch { return []; } };
  // Candidates: the named active installation, the two in-repo locations, and a bounded walk of the
  // plugin tree (layouts vary: cache/<marketplace>/<plugin>/<version>/, marketplaces/.../plugins/,
  // data/<plugin>/), deduplicated by real path so one physical file is never counted twice.
  // Keep BOTH paths: the one we were given and where it really points. Classifying by the real path
  // alone is an escape - a repository-local `scripts/security-redact.js` symlinked to a file outside
  // the tree would resolve "outside" and skip git validation entirely, while still being a path the
  // child can replace. So a candidate is repository-local if EITHER form is inside, and a
  // repository-local candidate must be a regular file at the path as given, not a link to one.
  const cands = [];
  const add = (p) => { const ap = path.resolve(p); if (!cands.some((c) => c.given === ap)) cands.push({ given: ap, real: real(ap) }); };
  if (process.env.CLAUDE_PLUGIN_ROOT) add(path.join(process.env.CLAUDE_PLUGIN_ROOT, "scripts", "security-redact.js"));
  for (const rel of [".claude/scripts/security-redact.js", "scripts/security-redact.js"]) add(path.join(root, rel));
  const plugins = [];
  let frontier = [path.join(require("os").homedir(), ".claude", "plugins")], seen = 0;
  for (let d = 0; d < 6 && frontier.length && seen < 4000; d++) {
    const next = [];
    for (const dir of frontier) {
      if (++seen > 4000) break;
      for (const c of [path.join(dir, "sd0x-dev-flow", "scripts", "security-redact.js"),
                       path.join(dir, "scripts", "security-redact.js")]) {
        const rp = fs.existsSync(c) && c.split(path.sep).includes("sd0x-dev-flow") ? real(c) : null;
        if (rp && !plugins.includes(rp)) plugins.push(rp);
      }
      next.push(...dirs(dir));
    }
    frontier = next;
  }
  if (plugins.length === 1) add(plugins[0]);
  // Pick the first candidate that is a regular file and, if it lives inside the repository, is
  // tracked and unmodified. THIS check is sound here and nowhere later: the tree is clean by the
  // precondition above and no write-capable child has run yet.
  const ok = cands.find((c) => {
    let st; try { st = fs.lstatSync(c.given); } catch { return false; }
    if (!st.isFile()) return false;                       // lstat: a symlink is never a candidate
    if (!inside(c.given) && (!c.real || !inside(c.real))) return true;   // genuinely outside the tree
    const rel = path.relative(root, c.real || c.given);
    try { execFileSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: root, stdio: "ignore" }); }
    catch { return false; }
    return execFileSync("git", ["status", "--porcelain", "-z", "--", rel], { cwd: root }).toString() === "";
  });
  if (!ok) { console.log("[STOP] no trusted security-redact.js to pin" + (plugins.length > 1 ? " (several plugin installations found - set CLAUDE_PLUGIN_ROOT)" : "")); process.exit(1); }
  console.log(ok.given);
  console.log(crypto.createHash("sha256").update(fs.readFileSync(ok.given)).digest("hex"));
'
```

Carry both lines — the absolute path and its digest — in the conversation, as you carry the
`threadId`. Step 3b takes them as its two arguments and refuses to run if the file no longer hashes
to that value.

### Step 1: Parse & Decompose

**`--spec` provided**: Read spec/request doc, extract individual items.
**Arguments without `--spec`**: Use directly as single item.
**No arguments**: Ask user for requirement, target file, reference files.

**Intent check**: identify the feature this work belongs to (from the spec, the task, or the
paths) and read `docs/features/<key>/intent-<key>.md` if it exists — its `INV-*` invariants and
Non-goals constrain every item; a planned item that contradicts one stops and asks the user
(cite the line). No identifiable feature → nothing to load; proceed.

Break into **implementation items** — each one logical unit (interface, method, endpoint), implementable in dependency order, small enough for one Codex call.

Present plan before starting:

```
| # | Item              | Target File          | Depends On |
|---|-------------------|----------------------|------------|
| 1 | Define interfaces | src/interface/x.ts   | -          |
| 2 | Core logic        | src/service/x.ts     | 1          |
| 3 | Controller/Route  | src/controller/x.ts  | 2          |

Proceed?
```

### Step 2: Collect Context (Claude, NOT Codex)

Claude researches the codebase before calling Codex:

1. Read `.claude/CLAUDE.md` (fallback `CLAUDE.md`) — tech stack, conventions, test commands
2. Read target file (if exists) and context files
3. Search similar implementations
4. Read 2-3 similar files for patterns

Summarize as `PROJECT_CONTEXT` for Codex.

### Step 3: Iterative Implementation

Implement **one item at a time**, in dependency order.

#### 3a: First item — new session

See `references/codex-prompts.md` for the full prompt template.

**Two reads, in this order, before EVERY item — 3a, every 3c, and every Step 5 dispatch alike.**
Saying "take the baseline after the precondition" was circular, since the precondition is evaluated
*against* a baseline; a reviewer caught it. They are two different reads:

1. a **pre-check** — `git status --porcelain --untracked-files=all --ignored` — which is what the
   precondition below is evaluated against;
2. once the user has resolved or accepted it, the **detector baseline**: the same status command
   plus `git rev-parse HEAD` and `git stash list`. Taking this one *after* the cleanup is what stops
   the user's own commit or stash being read as a Codex violation.

The detector baseline is what the table below compares against — 3a and each 3c alike, never once per session:
`git status --porcelain --untracked-files=all --ignored`. This skill owns the implementation lifecycle, so it owns
the baseline. Both flags matter, measured once in this checkout on 2026-08-30 as a dated example
and not a property of any tree: the bare command returned 92 entries where this returned 166. The
ratio is the point, not the numbers — `--untracked-files=all` because an untracked directory otherwise collapses to a
single line and hides its files, `--ignored` because ignored files are omitted entirely. Either
omission makes an existing path look newly created. Capturing once per session is the other half of
the same bug: rejecting item 2 against item 1's baseline can revert item 1's accepted work.
Rejection (Step 3b) reverts **only** paths absent from the current item's baseline.

**One precondition, checked BEFORE dispatching each item — 3a and every 3c alike.** Step 3b runs
*after* the Codex call, so a warning there reaches the user only once the overwrite has happened.

**The item's write set must be clean at baseline.** The prompt tells Codex to touch whatever the
item needs — tests, imports, call sites — so that set is not knowable in advance, which makes the
only checkable form of this condition the strong one: **every path in the baseline must be resolved
before dispatch** (commit, stash, or remove), or the user explicitly accepts **both** consequences,
named separately because they are different losses: this run has no working rollback at all, **and**
a modified baseline-present untracked or ignored file keeps its `??`/`!!` status, so Step 3b cannot
show it either — the "complete changeset" it promises is complete only over a tree that was clean at
baseline. Accepting the first is not accepting the second; ask for both.

Five review rounds were spent patching this branch one category at a time — staged changes, ignored
files, collapsed untracked directories, the ordering, and finally the discovery that a modified
baseline-present untracked or ignored file keeps its `??`/`!!` status and so cannot be *shown* to the
user at all, let alone restored. The diagnosis behind the current shape: git cannot give this
workflow reversibility on a dirty tree, and per-category reasoning kept finding one more category.
A single upfront condition is the thing that is actually true, so it replaced the sequence of
partial promises.

**What the condition does not cover, stated rather than implied.** This class runs Codex with
workspace write access, so nothing written here *prevents* what it does to the tree. What the
workflow can still do is **notice**, and three reviewers corrected an earlier version of this
paragraph that got the boundary wrong — it claimed staging bypasses Step 3b, which is false.
Measured:

| Operation | Visible to Step 3b? | Detected how |
|-----------|--------------------|--------------|
| **Staging** (`git add`) | **Yes** — `git diff HEAD` includes staged changes, and the status command shows the index column (`M ` rather than ` M`) | Already displayed; the Reject row stops on it |
| **Commit** | **No** — `HEAD` moves, so the *committed* changes vanish from `git diff HEAD`. Measured: after a full commit that display is empty, but a partial commit (`git commit -- <path>`) leaves everything else in it, so a non-empty diff is no evidence that nothing was committed | **Record `git rev-parse HEAD` with the baseline and compare after the item.** A moved `HEAD` means the decision was bypassed: say so and stop |
| **Stash** | **No**, for the stashed portion only — `git stash push` takes `--keep-index`, `--staged`, `--patch` and a pathspec, so anything it did not take stays visible. Same shape as the partial-commit row: what is still in the diff proves nothing about what was stashed | `git stash list` before and after — `git log` does not see a stash at all. **A changed list stops the item**, exactly as a moved `HEAD` does: show the new entries (`git stash list` and `git stash show -p <entry>`) and say that reviewed changes may have left the tree |
| `assume-unchanged` / `skip-worktree` on a tracked path | **No** — the path is absent from `git status` entirely, so neither the baseline nor Step 3b's display can see a local edit to it | The Step 0 probe above reads `git ls-files -v` and flags a tag that is `S` **or lowercase**. Measured: `h` = assume-unchanged, `S` = skip-worktree, `s` = both; `-v` lowercases only the assume-unchanged mark, so a lowercase-only test misses plain skip-worktree and a not-`H` test misdiagnoses `M` (an unmerged entry, reported separately with its own remedy). Step 0's precondition requires them cleared before any dispatch — this row used to read "nothing here detects it", which was true of `git status` and false of the index |

**Run the comparisons after every write-capable dispatch** — each item at 3a/3c and each Step 5
review-loop dispatch — not once at the end: an item that committed is only attributable to that item
if the check ran around it. The prompt forbids all three operations (`references/codex-prompts.md`), which is an **instruction,
not an enforcement** — the HEAD and stash comparisons above observe **persistent drift in those two values** — not the operation: a commit later undone inside the same item, or a stash created and popped, leaves both readings unchanged.


**Bind every placeholder before writing `prompt.md`.** The template is body-only, so nothing
evaluates an expression inside it — a `${X || 'default'}` would reach Codex as literal text. Two
have no natural empty form and this skill supplies it: `${CONTEXT_CONTENT}` becomes `None` when
there is no extra context, and `${TARGET_CONTENT}` becomes `(new file)` when the target does not
exist yet.

Dispatch per `@skills/codex-code-review/references/codex-transport.md` § Start with
**`--class implement`** — this skill is its only caller, and that class is what gives Codex
`workspace-write`. Guard 3 in `test/rules/codex-transport-guards.test.js` pins that ownership.

**The MCP era's ask-on-failure approval had no headless equivalent**, so the transport pins its own
policy instead — the value is in `@skills/codex-code-review/references/codex-transport.md` § Start, and naming it here would make this file a second
authority for it. The reason is that the exec transport is non-interactive: nobody could answer an
approval prompt, so the old policy could only hang or fail. The human control that replaced it is
**Step 3b below**, which shows the complete changeset and requires the user to accept, reject or
modify every item before the next one.

**Save the returned `threadId`.**

#### 3b: Confirm each item

After each Codex call, show the **complete** changeset, then ask the user. The changeset has two
halves and **both go through the scanner** — the single command below produces the whole display:

- **tracked modifications**, from `git diff HEAD` — `HEAD`, not a bare `git diff`, which shows only
  unstaged changes and would hide anything the item staged. Printing that diff directly was a leak
  path of its own: an item that writes a token into an existing tracked file and stages it puts the
  token in the diff, and the created-file scan never sees that file at all;
- **created paths**, from `git status --porcelain --untracked-files=all --ignored`, including
  ignored ones that `--exclude-standard` would omit. Listing filenames is not showing the changeset:
  this workflow explicitly supports new files (`${TARGET_CONTENT}` renders `(new file)`), so without
  the contents a user can accept source or test files they never saw.

**Nothing is printed until it has passed a content scan, and status alone is not the
boundary.** An earlier revision withheld ignored (`!!`) files and printed the rest, which is
half a rule: a `credentials.json` or a source file with an embedded token is routinely untracked
and *not* ignored, so a status test would have printed it. Two gates, and every printed path — a
tracked diff included — must clear both:

1. **Status.** An ignored path (`!!`) is never printed. `.gitignore` is the project's own statement
   that these files are not source, and it is where `.env`, credentials, key material and logs live —
   this repository ignores `.env` itself.
2. **Content.** Every path that *is* printed has its bytes scanned first, and the scan decides:
   high-confidence secret ⇒ withhold the file; medium-confidence ⇒ print the masked text, never the
   raw. This is what catches the non-ignored file the status gate lets through.

Both gates run under the existing `Bash(node:*)` grant, and deliberately so — this workflow adds no
command grant to display a changeset:

The whole thing is one `node` command that takes **no arguments** — locator and file list included.
Three constraints force that shape, each measured:

- the grant is `Bash(node:*)`, so a line beginning `REDACT=...` is not a command this skill may run;
- `require("scripts/security-redact.js")` resolves as a *package* name and fails with
  `Cannot find module`, so the locator resolves to an absolute path first;
- **and no created filename may reach a shell.** Codex chooses those names. A file called
  `$(printf SHELL_INJECTED >&2)` is expanded by the shell *before node starts* — measured, it
  printed `SHELL_INJECTED` — so interpolating paths into the command line hands a write-capable
  child arbitrary command execution in the parent. Node's `--` end-of-options marker does not help
  here: it protects node's own parser, one layer too late. The only fix is to remove the boundary:
  the program asks git for the created paths itself, NUL-delimited, and nothing about a filename is
  ever parsed by a shell.

The **two arguments it does take** are the redactor path and digest **Step 0 produced before the
dispatch**, and they are the exception that proves the rule: they are values this workflow computed
while the tree was still clean, not names the child chose. Both are **single-quoted** in the
invocation above, and that is not decoration — an ordinary installation path such as
`/Users/me/My Project/scripts/security-redact.js` would otherwise split into two arguments and the
run would stop with the second half read as a digest. Write an embedded apostrophe as `'\''`. The
digest is validated as 64 hex characters before anything is read, and the run stops if the file no
longer hashes to it.

```bash
node -e '
  const fs = require("fs"), path = require("path");
  const { execSync, execFileSync } = require("child_process");
  const MAX_BYTES = 1 << 20, MAX_LINES = 500;
  // The repository root, for the same reason the Step 0 probe resolves it: paths are root-relative
  // and the redactor lives under the root, so a nested invocation would mislocate both.
  const root = execSync("git rev-parse --show-toplevel").toString().trim();
  // THE REDACTOR IS CODE THIS COMMAND EXECUTES, and it runs AFTER a workspace-write child. So the
  // candidate list is trust-ordered, not convenience-ordered: a plugin copy outside the workspace
  // first (Codex is confined to the repository by `-C <toplevel>`, so it cannot write there), and an
  // in-repo copy only when git says this run did not create or modify it. Without that, Codex could
  // drop a `.claude/scripts/security-redact.js` of its own and the confirmation step would execute
  // it before the user was asked to accept anything.
  // The redactor is pinned, not searched. Step 0 resolved it and recorded its digest BEFORE the
  // write-capable dispatch; this process only checks that the same bytes are still there. Searching
  // here cannot be made safe: after a write-capable child has run, a tracked file marked
  // `assume-unchanged` and then overwritten still reports clean, and a path replaced by a symlink
  // resolves somewhere else - so every predicate evaluated at this point can be arranged to pass.
  const crypto = require("crypto");
  const [pinnedPath, pinnedDigest] = process.argv.slice(1);
  if (!pinnedPath || !/^[0-9a-f]{64}$/.test(pinnedDigest || "")) {
    console.log("[STOP] this command takes the redactor path and its 64-hex digest from Step 0; re-run Step 0 to obtain them");
    process.exit(1);
  }
  let pst; try { pst = fs.lstatSync(pinnedPath); } catch { pst = null; }
  if (!pst || !pst.isFile()) {
    console.log(`[STOP] the pinned redactor is missing or is no longer a regular file: ${pinnedPath}`);
    process.exit(1);
  }
  // ONE read. The bytes that are hashed are the bytes that are executed - `require(pinnedPath)`
  // would open the pathname a second time, and between the two opens a background process left by
  // the child can swap the file. Compiling the verified buffer closes that window by construction;
  // no ordering of checks around a second open can.
  const src = fs.readFileSync(pinnedPath);
  const nowDigest = crypto.createHash("sha256").update(src).digest("hex");
  if (nowDigest !== pinnedDigest) {
    console.log(`[STOP] the redactor changed since Step 0 pinned it (${pinnedPath}); this run may have written it - restore it and re-run`);
    process.exit(1);
  }
  const Module = require("module");
  const mod = new Module(pinnedPath, null);
  mod.filename = pinnedPath;
  mod.paths = Module._nodeModulePaths(path.dirname(pinnedPath));
  mod._compile(src.toString("utf8"), pinnedPath);
  const { redact } = mod.exports;
  if (typeof redact !== "function") {
    console.log(`[STOP] the pinned redactor exports no redact() function: ${pinnedPath}`);
    process.exit(1);
  }
  // CAPABILITY CHECK, defence in depth behind the digest. The pin proves the bytes did not change
  // since Step 0; it does not prove Step 0 pinned a redactor that actually works - an older
  // installation is unchanged and still gets the positional cases wrong (the value equal to, or
  // inside, its own key). A redactor that fails this is not used at all: with no trustworthy scan,
  // nothing may be printed.
  for (const probe of ["{\"password\":\"pass\"}", "API_TOKEN=TOKEN"]) {
    let masked; try { masked = redact(probe); } catch { masked = ""; }
    if (!masked.includes("[REDACTED]") || /:"pass"|=TOKEN/.test(masked)) {
      console.log(`[STOP] the pinned redactor (${pinnedPath}) fails its capability probe - it leaves ${probe} unmasked, so it is an older copy; point CLAUDE_PLUGIN_ROOT at the active installation or update it, then re-run Step 0`);
      process.exit(1);
    }
  }
  // Half one: the tracked diff, per file, each hunk set scanned before it is shown. A diff is text
  // like any other and a token written into an existing tracked file arrives here, not in the
  // created-path loop below.
  // A repository with no commit yet has no HEAD to diff against, and that is not an error: every
  // path in it is a created path and the loop below covers them all. Failing here would take the
  // whole display down on the first item of a brand-new project.
  let diffNames = [];
  try {
    diffNames = execSync("git diff --name-only -z HEAD", { cwd: root, maxBuffer: 1 << 28 })
      .toString().split("\0").filter(Boolean);
  } catch { diffNames = []; }
  for (const rel of diffNames) {
    let d;
    try { d = execFileSync("git", ["diff", "HEAD", "--", rel], { cwd: root, maxBuffer: 1 << 28 }).toString(); }
    catch (e) { console.log(`[WITHHELD unreadable-diff] ${rel} — ${e.code}`); continue; }
    if (d.length > MAX_BYTES) { console.log(`[WITHHELD oversized-diff] ${rel} (${d.length} bytes)`); continue; }
    let safeDiff; try { safeDiff = redact(d); }
    catch (e) { console.log(`[WITHHELD secret-in-diff] ${rel} — ${e.name}; inspect it locally`); continue; }
    console.log(`--- diff ${rel}`); console.log(safeDiff);
  }
  // Half two: the created paths, asked of git INSIDE this process. `-z` is NUL-delimited, so a
  // filename may contain spaces, quotes, newlines or shell metacharacters and still arrive as one
  // field.
  const fields = execSync("git status --porcelain=v1 -z --untracked-files=all --ignored",
    { cwd: root, maxBuffer: 1 << 28 }).toString().split("\0");
  for (let i = 0; i < fields.length; i++) {
    const e = fields[i];
    if (!e || e.length < 4) continue;
    const x = e[0], y = e[1], rel = e.slice(3);
    if (x === "R" || x === "C") { i++; continue; }   // rename/copy carries an origin field too
    const ignored = x === "!" && y === "!";
    const created = ignored || (x === "?" && y === "?") || x === "A";
    if (!created) continue;
    // Gate 1, status: an ignored path is named and never read. .gitignore is the project saying
    // these are not source, and it is where .env, credentials, keys and logs live.
    if (ignored) { console.log(`[WITHHELD ignored] ${rel} — inspect it locally`); continue; }
    const p = path.resolve(root, rel);
    // Gate 2, the filesystem node, BEFORE any read. lstat does not follow links, so a symlink is
    // classified as one; readFileSync would have followed it out of the repository, and a FIFO or
    // device would block. Size is checked here too — a multi-gigabyte or sparse file must never be
    // read into memory to discover it was too big.
    if (p !== root && !p.startsWith(root + path.sep)) { console.log(`[WITHHELD outside-repo] ${rel}`); continue; }
    let st; try { st = fs.lstatSync(p); } catch (e) { console.log(`[WITHHELD unreadable] ${rel} — ${e.code}`); continue; }
    if (!st.isFile()) { console.log(`[WITHHELD non-regular] ${rel} (${st.isSymbolicLink() ? "symlink" : "not a regular file"})`); continue; }
    if (st.size > MAX_BYTES) { console.log(`[WITHHELD oversized] ${rel} (${st.size} bytes)`); continue; }
    let buf; try { buf = fs.readFileSync(p); } catch (e) { console.log(`[WITHHELD unreadable] ${rel} — ${e.code}`); continue; }
    // Metadata without `file` or `wc`: a NUL byte is the binary test, newlines are the line count.
    if (buf.includes(0)) { console.log(`[WITHHELD binary] ${rel} (${buf.length} bytes)`); continue; }
    const text = buf.toString("utf8"), lines = text.split("\n").length;
    if (lines > MAX_LINES) { console.log(`[WITHHELD oversized] ${rel} (${lines} lines)`); continue; }
    // Gate 3, content. Redact FIRST, then print: a header before the scan announces a file the scan
    // is about to refuse, and the reader has to notice the WITHHELD line to know it was void.
    let safe; try { safe = redact(text); }
    catch (e) { console.log(`[WITHHELD secret] ${rel} — ${e.name}; inspect it locally`); continue; }
    console.log(`--- ${rel} (${lines} lines)`); console.log(safe);
  }
' -- '<the path Step 0 printed>' '<the digest Step 0 printed>'
```

For every withheld path — ignored, binary, oversized, secret-bearing, non-regular or outside the
repository — give the path, the reason
and its size, say plainly that the contents were withheld, and ask the user to inspect it locally
before deciding. **Name the reason, never the matched value** (`@rules/security.md`; a fingerprint is
what `security-redact.js` returns for that purpose). Accepting a file unseen is the user's explicit
call, not a silent default.

What is printed, then, is the ordinary case this workflow exists for — new source and test files,
untracked, not ignored, and carrying no secret the scan can see.

The same commands and the same two gates apply at **Step 4**'s final confirmation, not only here.

| Choice | Action |
|--------|--------|
| Accept | Proceed to next item (3c) |
| Reject | Revert **only paths absent from this item's baseline** (`git checkout -- <path>…`) — those had no state to lose, which is true only because Step 0 refused to dispatch while any `assume-unchanged` / `skip-worktree` path existed: such a path is baseline-absent *and* holds state, and reverting it destroys the edit. Any path that appeared in the baseline in **any** column (staged, unstaged or untracked) is never reverted automatically: name it, show `git diff -- <path>`, and let the user decide, because its pre-item contents were overwritten and nothing here can recover them. Files the item created are baseline-absent, but `git checkout --` cannot restore a file with no committed version — removal is a separate, confirmed action: show each and ask. If the item **staged** anything, stop and say so — `git checkout --` restores from the index. Never a bare `git checkout .`. Re-attempt (max 2 retries, then ⛔) |
| Modify | § Resume with feedback on the same thread → loop back to 3b |

#### 3c: Subsequent items — same thread

Dispatch per that reference's § Resume with the saved `threadId` — **still `--class implement`**, since the class does not change across a thread and a continuation must still be able to make edits. See `references/codex-prompts.md`.

Repeat 3b → 3c until all items done.

### Step 4: Final Confirmation

the same complete changeset as Step 3b — `git diff HEAD`, plus the untracked-and-ignored listing
with the contents of each printable new file and the named-but-withheld entry for each ignored,
binary, oversized or secret-bearing one → user confirms.

### Step 5: Review Loop (Codex-in-the-loop)

**Every dispatch in this loop is a dispatch**: re-record the baseline and re-check the precondition
before each one, exactly as at 3a and 3c. A reviewer found the loop reaching § Resume without either,
so a run that started clean could accumulate unacknowledged overwrites here.


**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

| Step | Command | On fail |
|------|---------|---------|
| 1 | `/codex-review-fast` | § Resume on the same thread to fix → re-review |
| 2 | `/precommit` | § Resume on the same thread to fix → re-run |

Issues found → **use same Codex thread to fix** (not manual). See `references/codex-prompts.md` for fix prompt.

Max 3 rounds per step. Still failing → report blocker.

#### Test Requirements

| Change Type | Required Tests |
|-------------|---------------|
| New service/provider | Unit (happy + error + edge) |
| New API endpoint | Unit + integration |
| Modified logic | Existing pass + new logic tests |
| Bug fix scenario | Regression test |

If Codex omitted tests → § Resume on the same thread to request them.

## Output

```markdown
## Codex Implementation Report

### Implementation Items

| # | Item | Target File | Status |
|---|------|-------------|--------|
| 1 | ...  | ...         | ✅/❌  |

### Change Summary

| File | Operation | Description |
|------|-----------|-------------|
| ...  | Create/Modify | ...     |

### Review Result
<codex-review-fast output>

### Gate
✅ Complete / ⛔ Needs modification
```

## Verification

- [ ] All items implemented and confirmed
- [ ] Tests included for each item
- [ ] `/codex-review-fast` passed
- [ ] `/precommit` passed

## Examples

```
/codex-implement "Add a method to calculate fees"
/codex-implement "Implement wallet service" --spec docs/features/wallet/2-tech-spec.md
/codex-implement "Add getUserBalance method" --target src/service/wallet.service.ts
/codex-implement "Implement cache logic" --target src/service/cache.ts --context src/service/redis.ts
```
