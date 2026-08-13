'use strict';

// Behaviour-layer pins carried over from the deleted test/rules/stall-detection.test.js.
// That file pinned the hook emitter contract ([LOOP_STALL]/[STRATEGIC_RESET]) and died with
// its subject (hook-lightweighting); the tier caps and the anti-loop budget were behaviour-layer
// assertions and survive here, re-pinned against the rewritten rule text.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const autoLoop = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8');

test('tier table maps each tier to its blocking severities and round cap', () => {
  assert.match(autoLoop, /\| `fast` \| Docs, comments, config, small low-risk edits \| P0 \| 6 \|/,
    'fast: P0 blocks, cap 6');
  assert.match(autoLoop, /\| `standard` \*\*\(default\)\*\* \| Ordinary features and bug fixes \| P0, P1 \| 15 \|/,
    'standard: P0/P1 block, cap 15');
  assert.match(autoLoop, /\| `thorough` \| Security, data integrity, releases, public API \| P0, P1, P2 \| 30 \|/,
    'thorough: P0/P1/P2 block, cap 30');
});

test('anti-loop budget: one cap diagnosis, three stall diagnoses, then a human', () => {
  assert.match(autoLoop, /\| Round cap \| \*\*1\*\* diagnosis per change \|/,
    'the cap earns exactly one diagnosis per change');
  assert.match(autoLoop, /\| Stall \| \*\*3\*\* per change \|/,
    'stalls earn three diagnoses per change');
  assert.match(autoLoop, /A \*\*fourth\*\* stall on the same change → ⚠️ Need Human/,
    'a fourth stall must route to a human, not a fourth diagnosis');
});

test('stall detection is model-side bookkeeping — no hook emitter is promised', () => {
  assert.doesNotMatch(autoLoop, /\[LOOP_STALL\]|\[LOOP_PROGRESS\]|\[STRATEGIC_RESET\]|\[STALL_MEMORY\]/,
    'the emitters died with their recorder (hook-lightweighting) — the rule must not promise them');
  assert.match(autoLoop, /\*\*3\*\* consecutive stall rounds is the signal/,
    'the three-round threshold survives as behaviour-layer guidance');
  assert.match(autoLoop, /Never re-try an adjustment recorded as failed/,
    'the stall-memory lesson survives the mechanism');
});

test('the rounds count is named as the one mechanical fact, honestly scoped', () => {
  assert.match(autoLoop, /`rounds` count \(`review-state\.js check --format=json`\)/,
    'the state slot rounds count is the surviving mechanical input');
  assert.match(autoLoop, /it counts failed verdicts on the current change, not your conversational rounds/,
    'the count must be scoped honestly — a floor, not the whole story');
});
