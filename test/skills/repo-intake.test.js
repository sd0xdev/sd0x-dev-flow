'use strict';
// Pins the WB8 contract for skills/repo-intake/SKILL.md and its manifest-map
// reference: the SKILL.md stays a thin dispatcher surface (<150 lines) and the
// declared-dependency semantics stay stated where readers land.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKILL = path.join(ROOT, 'skills', 'repo-intake', 'SKILL.md');
const REF = path.join(ROOT, 'skills', 'repo-intake', 'references', 'manifest-map.md');
const SCRIPT = path.join(ROOT, 'skills', 'repo-intake', 'scripts', 'manifest_map.js');

describe('repo-intake SKILL.md manifest-map surface', () => {
  const skillText = fs.readFileSync(SKILL, 'utf8');

  test('SKILL.md stays under the 150-line budget', () => {
    const lines = skillText.split('\n').length;
    assert.ok(lines < 150, `SKILL.md is ${lines} lines; WB8 budget is <150`);
  });

  test('SKILL.md documents manifest_map.js via run-skill.sh with all query modes', () => {
    assert.match(skillText, /run-skill\.sh repo-intake manifest_map\.js/);
    assert.match(skillText, /--reverse/);
    assert.match(skillText, /--cycles/);
    assert.match(skillText, /--include-candidates/);
    assert.match(skillText, /declares_dependency/);
  });

  test('SKILL.md links the manifest-map reference and the tech spec', () => {
    assert.match(skillText, /references\/manifest-map\.md/);
    assert.match(skillText, /docs\/features\/repo-intake-manifest-map\/2-tech-spec\.md/);
  });

  test('scripts table lists manifest_map.js and the script exists', () => {
    assert.match(skillText, /`scripts\/manifest_map\.js`/);
    assert.ok(fs.existsSync(SCRIPT));
  });
});

describe('manifest-map reference honesty', () => {
  const refText = fs.readFileSync(REF, 'utf8');

  test('reference states the single edge semantics and its negative claim', () => {
    assert.match(refText, /declares_dependency/);
    assert.match(refText, /不證明.*import/);
  });

  test('reference names the fail-closed contract, not a best-effort one', () => {
    assert.match(refText, /fail-closed/);
    assert.match(refText, /絕不出現猜測邊|絕不產生猜測邊/);
    assert.match(refText, /unverified_workspace_match/);
  });

  test('reference defers authority to the tech spec', () => {
    assert.match(refText, /2-tech-spec\.md/);
    assert.match(refText, /以規格為準/);
  });
});
