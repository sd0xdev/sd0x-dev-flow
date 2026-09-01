'use strict';

// Pins rules/docs-writing.md § Durable References (review-loop-recovery).
// The rule is behavior-layer prose — there is no checker to exercise — so the guard-path proof
// (rules/testing.md § Conventions, Guards row) is carried by the rule's own example table: the
// forbidden form and the exempt form use the SAME pointer string, so the section cannot drift
// into banning records or exempting maintained docs without a pin going red.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const docsWriting = readFileSync(
  resolve(__dirname, '../..', 'rules/docs-writing.md'), 'utf8');

test('Durable References section exists and states the anchor rule', () => {
  assert.match(docsWriting, /## Durable References/, 'section heading must exist');
  assert.match(docsWriting, /semantic anchors\*\*, not exact line numbers/,
    'the rule is anchors over line numbers');
  assert.match(docsWriting, /never the sole locator/,
    'a numeric hint may never stand alone');
});

test('the same pointer string is forbidden as sole locator and exempt inside a record', () => {
  // Both directions of the guard, on one representative string.
  assert.match(docsWriting,
    /`scripts\/lib\/utils\.js:142` as the sole locator in a maintained doc \| ❌/,
    'the forbidden case must be shown and flagged');
  assert.match(docsWriting,
    /`scripts\/lib\/utils\.js:142` inside a review finding, request ticket, ADR or review log \| ✅ Exempt/,
    'the identical string must pass as point-in-time evidence in a record');
  assert.match(docsWriting, /rewriting those to match today's code would destroy the record/,
    'the exemption states its reason — records are frozen evidence');
});

test('conversion is incremental, never a mass rewrite', () => {
  assert.match(docsWriting,
    /convert on substantive edit or via a declared\s+`\/refactor --mode reference-stability` pass — never a mass rewrite/,
    'the existing reference stock converts incrementally');
});
