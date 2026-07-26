// Regression guard for the review-state ignore patterns in the project .gitignore (iter-18 P2-A).
// The shipped fix is two lines:
//     .claude_review_state.json
//     .claude_review_state.json.*
// which thread between two failure modes the assertions below pin down:
//   - Too GREEDY (a single glob `.claude_review_state.json*`): would also swallow any tracked
//     source file whose name merely starts with the stem (`…json-helper.js`).
//   - Too NARROW (a bare exact line `.claude_review_state.json`, as at this branch's base commit):
//     ignores the state file itself but MISSES the runtime sidecars we need ignored
//     (`.blocked`, `.lockdir`, `mktemp` temps `…json.XXXXXX`).
// The `.json.*` second line ignores the sidecars WITHOUT the `-helper.js` over-match — it requires
// a literal `.` after `json`, which is what makes the leading `/` unnecessary for precision.
// The patterns are deliberately UNANCHORED. Both hooks set `STATE_FILE=".claude_review_state.json"`
// RELATIVE to their working directory (`post-tool-review-state.sh:33`, `session-init.sh:6`), so in
// a monorepo whose session cwd is a package subdirectory the state file lands at
// `packages/api/.claude_review_state.json`. A root-anchored `/…` pattern leaves that copy tracked,
// and the state file records session ids and changed-file paths.
// This test copies the PROJECT's real .gitignore into a throwaway repo so it tracks the shipped
// patterns (not a hand-copied subset that could silently drift), then asserts `git check-ignore`.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, copyFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const projectGitignore = join(__dirname, '../../.gitignore');
const tempDirs = [];

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-gitignore-'));
  tempDirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  copyFileSync(projectGitignore, join(dir, '.gitignore'));
  return dir;
}

// `git check-ignore -q` exits 0 when the path IS ignored, 1 when it is not. Works on paths that
// do not exist on disk, so we can probe hypothetical sidecar/source names directly.
function isIgnored(dir, relPath) {
  return spawnSync('git', ['check-ignore', '-q', '--', relPath], { cwd: dir }).status === 0;
}

after(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

test('.gitignore ignores the review-state file and every dot-separated runtime sidecar', () => {
  const dir = makeRepo();
  // Runtime sidecars: `.blocked` (fail-closed marker), `.lockdir` (lock), and the
  // `mktemp "${STATE_FILE}.XXXXXX"` temp files written by the review-state hooks.
  assert.ok(isIgnored(dir, '.claude_review_state.json'), 'state file itself must be ignored');
  assert.ok(isIgnored(dir, '.claude_review_state.json.blocked'), '.blocked sidecar must be ignored');
  assert.ok(isIgnored(dir, '.claude_review_state.json.lockdir'), '.lockdir sidecar must be ignored');
  assert.ok(isIgnored(dir, '.claude_review_state.json.Ab3xYz'), 'mktemp .XXXXXX temp must be ignored');
});

test('.gitignore ignores the state file in a subdirectory (monorepo session cwd)', () => {
  const dir = makeRepo();
  // Both hooks resolve STATE_FILE relative to their cwd, so a session rooted at a package
  // subdirectory writes the state file and its sidecars there. A root-anchored pattern
  // (`/.claude_review_state.json`) leaves those tracked — verified: before this change,
  // `git check-ignore sub/.claude_review_state.json` reported NOT ignored.
  assert.ok(isIgnored(dir, 'packages/api/.claude_review_state.json'), 'nested state file must be ignored');
  assert.ok(
    isIgnored(dir, 'packages/api/.claude_review_state.json.lockdir'),
    'nested sidecar must be ignored'
  );
});

test('.gitignore does NOT ignore source files that merely share the state-file stem (over-match hole closed)', () => {
  const dir = makeRepo();
  // `.claude_review_state.json.*` requires a literal dot after `json`, so a dash- or
  // path-suffixed source file is NOT a sidecar and must stay tracked. The pre-fix glob
  // `.claude_review_state.json*` wrongly ignored both of these — reverting to it fails this test.
  assert.equal(
    isIgnored(dir, '.claude_review_state.json-helper.js'),
    false,
    'dash-suffixed source sharing the stem must stay tracked'
  );
  assert.equal(
    isIgnored(dir, 'sub/.claude_review_state.json-notes.md'),
    false,
    'a nested non-sidecar sharing the stem must stay tracked'
  );
});
