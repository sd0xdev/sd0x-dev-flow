'use strict';

/**
 * integration.test.js — necessity-audit Phase A → B → C end-to-end.
 *
 * White-box integration: drives the pipeline in-process via module exports.
 * The CLI-level lifecycle-scope guard (`assertLifecycleScope`) is covered
 * separately in preflight.test.js; this file focuses on data-flow integrity:
 *
 *   fixture spec
 *     → extractElements
 *     → classifyAll
 *     → parseDebateResponse (mock)
 *     → consolidate
 *     → buildMarkdown
 *     → assert gate, sentinels, banners, deterministic checks.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { extractElements } = require('../../../scripts/skills/necessity-audit/elements');
const { classifyAll } = require('../../../scripts/skills/necessity-audit/classify');
const { parseDebateResponse } = require('../../../scripts/skills/necessity-audit/debate-topic');
const { consolidate, AUDIT_CLEAR, AUDIT_REVISE } = require('../../../scripts/skills/necessity-audit/consolidate');
const { buildMarkdown } = require('../../../scripts/skills/necessity-audit/report');

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'necessity-audit');
const SPEC_PATH = path.join(FIXTURE_DIR, 'sample-over-designed-spec.md');
const DEBATE_PATH = path.join(FIXTURE_DIR, 'mock-debate-response.txt');

function loadFixture() {
  return {
    specContent: fs.readFileSync(SPEC_PATH, 'utf8'),
    debateRaw: fs.readFileSync(DEBATE_PATH, 'utf8'),
  };
}

function makePreflight(activeDimensions = [1, 2, 3, 4, 5, 6]) {
  return {
    absPath: SPEC_PATH,
    relPath: 'test/fixtures/necessity-audit/sample-over-designed-spec.md',
    featureKey: 'necessity-audit-fixture',
    docKind: 'requirements',
    greenfield: true,
    depth: 'normal',
    activeDimensions,
    skipPreflight: false,
    banners: [],
    warnings: [],
  };
}

test('integration — full pipeline yields non-empty elements list from fixture', () => {
  const { specContent } = loadFixture();
  const elements = extractElements(specContent, 'requirements');
  // fixture has 5 FRs + 2 NFRs = 7 elements
  assert.equal(elements.length, 7, 'fixture should yield exactly 7 FR/NFR rows');
  const ids = elements.map(e => e.id);
  assert.deepEqual(ids, ['FR-1', 'FR-2', 'FR-3', 'FR-4', 'FR-5', 'NFR-1', 'NFR-2']);
});

test('integration — Phase A classify marks FR-2 (zero consumers) and FR-3 (no performance data) as Cut', () => {
  const { specContent } = loadFixture();
  const elements = extractElements(specContent, 'requirements');
  const classified = classifyAll(elements, [1, 2, 3, 4, 5, 6], specContent);
  const byId = Object.fromEntries(classified.map(e => [e.id, e.claude.classification]));
  assert.equal(byId['FR-1'], 'Keep', 'FR-1 plain OAuth login → Keep');
  assert.equal(byId['FR-2'], 'Cut', 'FR-2 "zero consumers" → High[2] → Cut');
  assert.equal(byId['FR-3'], 'Cut', 'FR-3 "without any performance data" → High[5] → Cut');
  assert.equal(byId['FR-5'], 'Keep', 'FR-5 audit log → Keep');
});

test('integration — parseDebateResponse extracts 5 per-element verdicts + threadId + rounds=3', () => {
  const { debateRaw } = loadFixture();
  const debate = parseDebateResponse(debateRaw);
  assert.equal(debate.rounds, 3);
  assert.ok(debate.threadId.length > 0, 'threadId must be parsed');
  assert.ok(debate.equilibriumReached, 'equilibrium line must be detected');
  assert.equal(debate.perElementVerdicts.length, 5, 'fixture has 5 FR verdicts');
  const verdictMap = Object.fromEntries(debate.perElementVerdicts.map(v => [v.id, v.classification]));
  assert.equal(verdictMap['FR-2'], 'Cut');
  assert.equal(verdictMap['FR-3'], 'Cut');
  assert.equal(verdictMap['FR-4'], 'Review');
});

test('integration — consolidate applies stricter-of(claude, codex) and emits gate ⛔ when un-overridden Cuts exist', () => {
  const { specContent, debateRaw } = loadFixture();
  const elements = extractElements(specContent, 'requirements');
  const classified = classifyAll(elements, [1, 2, 3, 4, 5, 6], specContent);
  const debate = parseDebateResponse(debateRaw);
  const preflight = makePreflight();

  const report = consolidate({
    phaseA: { elements: classified },
    debate,
    preflight,
    overrides: '',
    depth: 'normal',
  });

  assert.equal(report.gate, AUDIT_REVISE, 'un-overridden Cuts must fail the gate');
  const cutIds = report.elements.filter(e => e.final === 'Cut').map(e => e.id).sort();
  assert.deepEqual(cutIds, ['FR-2', 'FR-3'], 'FR-2 + FR-3 should be final=Cut');
  assert.ok(report.narrative.some(n => /flagged for removal/.test(n)), 'narrative must mention removal count');
});

test('integration — all 6 deterministic checks pass against well-formed mock debate', () => {
  const { specContent, debateRaw } = loadFixture();
  const classified = classifyAll(extractElements(specContent, 'requirements'), [1, 2, 3, 4, 5, 6], specContent);
  const debate = parseDebateResponse(debateRaw);
  const report = consolidate({
    phaseA: { elements: classified },
    debate,
    preflight: makePreflight(),
    overrides: '',
    depth: 'normal',
  });

  const checks = report.deterministic_checks;
  assert.equal(checks.rounds_ok, true, 'rounds=3 >= 2');
  assert.equal(checks.has_evidence_citation, true, 'mock debate has evidence lines per verdict');
  assert.equal(checks.has_explicit_stance, true, 'conclusion mentions Accept/Reject/Concede');
  assert.equal(checks.has_threadId, true);
  assert.equal(checks.equilibrium_required_met, true, 'depth=normal relaxes this check');
  assert.equal(checks.conclusion_references_rounds, true, 'conclusion references "round 1/2/3"');
});

test('integration — partial --override still ⛔ Audit Revise; full --override coverage flips to ✅ Audit Clear', () => {
  // Guards the override mechanics: overriding ONE of two Cuts must still ⛔.
  // Overriding BOTH should pass.
  const { specContent, debateRaw } = loadFixture();
  const classified = classifyAll(extractElements(specContent, 'requirements'), [1, 2, 3, 4, 5, 6], specContent);
  const debate = parseDebateResponse(debateRaw);

  const partial = consolidate({
    phaseA: { elements: classified },
    debate,
    preflight: makePreflight(),
    overrides: 'FR-2:compliance says keep',
    depth: 'normal',
  });
  assert.equal(partial.gate, AUDIT_REVISE, 'FR-3 still un-overridden Cut');

  const full = consolidate({
    phaseA: { elements: classified },
    debate,
    preflight: makePreflight(),
    overrides: 'FR-2:compliance says keep; FR-3:benchmark exists in ops repo',
    depth: 'normal',
  });
  assert.equal(full.gate, AUDIT_CLEAR, 'all Cuts overridden → Audit Clear');
  assert.ok(full.narrative.some(n => /kept via --override/.test(n)), 'narrative must cite override count');
});

test('integration — buildMarkdown produces MCP-conformant report with header + gate sentinel tail', () => {
  const { specContent, debateRaw } = loadFixture();
  const classified = classifyAll(extractElements(specContent, 'requirements'), [1, 2, 3, 4, 5, 6], specContent);
  const debate = parseDebateResponse(debateRaw);
  const report = consolidate({
    phaseA: { elements: classified },
    debate,
    preflight: makePreflight(),
    overrides: 'FR-2:keep; FR-3:keep',
    depth: 'normal',
  });

  const md = buildMarkdown(report);
  assert.match(md, /^## Necessity Audit/m, 'report header must be present');
  assert.match(md, /^### Gate/m, 'gate section present');
  // Gate sentinel should appear as a tail line; check both presence + position (last sentinel is last match)
  const sentinelMatches = md.match(/✅ Audit Clear|⛔ Audit Revise/g) || [];
  assert.ok(sentinelMatches.length >= 1, 'at least one gate sentinel in body');
  assert.equal(sentinelMatches[sentinelMatches.length - 1], AUDIT_CLEAR, 'tail sentinel matches report.gate');
});

test('integration — depth=brief active dims filter drops FR-3 (dim 5) from classification', () => {
  const { specContent } = loadFixture();
  const elements = extractElements(specContent, 'requirements');
  const classified = classifyAll(elements, [1, 2, 3], specContent);
  const ids = classified.map(e => e.id);
  assert.ok(!ids.includes('FR-3'), 'FR-3 primary_dim=5 excluded when brief');
  assert.ok(!ids.includes('NFR-1'), 'NFR-1 primary_dim=5 (response time) excluded when brief');
  assert.ok(ids.includes('FR-2'), 'FR-2 primary_dim=2 retained under brief');
});

test('integration — under-covered dimensions reported when depth=deep but debate skips a dim', () => {
  const { specContent } = loadFixture();
  const classified = classifyAll(extractElements(specContent, 'requirements'), [1, 2, 3, 4, 5, 6], specContent);
  // Hand-crafted debate that mentions only dim 1+2 keywords
  const narrowDebate = {
    threadId: 'abc123def456abc123def456',
    rounds: 3,
    equilibriumReached: true,
    conclusion: 'Reached equilibrium in round 1. Accept Necessity Now and Abstraction Justification framing only.',
    evidenceCitations: [],
    roundsText: 'Necessity Now and Abstraction Justification covered.',
    perElementVerdicts: [],
  };

  const report = consolidate({
    phaseA: { elements: classified },
    debate: narrowDebate,
    preflight: makePreflight([1, 2, 3, 4, 5, 6]),
    overrides: '',
    depth: 'deep',
  });

  assert.ok(report.under_covered_dimensions.length > 0, 'dims 3/4/5/6 must be flagged');
  assert.ok(report.under_covered_dimensions.includes(5), 'dim 5 not mentioned in narrow debate');
  assert.ok(
    report.narrative.some(n => /under-covered/.test(n)),
    'narrative must surface under-covered dims',
  );
});
