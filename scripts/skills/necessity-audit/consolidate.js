#!/usr/bin/env node
'use strict';

/**
 * consolidate.js — necessity-audit Phase C.
 *
 * Merges Phase A classification with Codex debate result.
 * Applies --override flags, runs 6 deterministic checks + under-coverage check,
 * selects gate sentinel (always AUDIT_CLEAR or AUDIT_REVISE; ⚠️ Need Human is narrative only).
 *
 * CLI:
 *   node consolidate.js --phase-a <file> --debate <file> --preflight <file> --overrides "<id>:<rationale>[;...]" --depth <d> --output <file>
 */

const fs = require('fs');

/**
 * Gate sentinels — deliberately NOT the doc-review vocabulary.
 *
 * These used to be doc review's own `Mergeable` / `Needs revision` pair, on the reasoning
 * (1-requirements FR-7 / NFR-5) that reusing doc review's words bought auto-loop compatibility.
 * It did not: this skill assembles its report locally and emits it as the model's own message,
 * so it was never a doc-review verdict — and sentinels are behaviour-layer signals the model and
 * reviewers read in conversation (hook-lightweighting § 3.3: nothing parses them anymore). A
 * necessity audit ending in a bare `✅ Mergeable` still reads, to the model deciding whether the
 * doc gate is satisfied, exactly like a doc review that never ran. The namespaced pair keeps the
 * two verdicts unconfusable — the same fix `✅ Plan Ready` / `⛔ Plan Blocked` applies to the plan
 * plane. (Historically this also collided with the deleted enforcement hooks' transcript greps —
 * that machinery is gone, but the readability collision it exposed is the reason that stands.)
 * Pinned by test/skills/necessity-audit/stop-guard-isolation.test.js.
 */
const AUDIT_CLEAR = '✅ Audit Clear';
const AUDIT_REVISE = '⛔ Audit Revise';

const STRICTER = { Keep: 0, Review: 1, Cut: 2 };
const STANCE_RE = /\b(Challenge|Defend|Accept|Reject|Concede)\w*/i;
const ROUND_REF_RE = /\b(?:round\s+\d+|R\d+)\b/i;

const DIM_NAMES = {
  1: 'Necessity Now',
  2: 'Abstraction Justification',
  3: 'Extensibility Speculation',
  4: 'Configurability Excess',
  5: 'Premature Optimization',
  6: 'Scope Drift',
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesElementId(location, elementId) {
  const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegex(elementId)}(?:$|[^A-Za-z0-9])`, 'i');
  return re.test(location);
}

function mergeVerdicts(phaseA, debate) {
  const perElementVerdicts = debate.perElementVerdicts || [];
  const citations = debate.evidenceCitations || [];

  return phaseA.elements.map(el => {
    const codexVerdict = perElementVerdicts.find(v => v.id.toLowerCase() === el.id.toLowerCase());

    const idTagged = citations
      .filter(c => c.elementId && c.elementId.toLowerCase() === el.id.toLowerCase())
      .map(({ elementId, ...rest }) => rest);
    const textMatched = citations
      .filter(c => !c.elementId && matchesElementId(c.location, el.id));
    const codexEv = [...idTagged, ...textMatched];

    let codex;
    if (codexVerdict) {
      codex = {
        classification: codexVerdict.classification,
        rationale: codexVerdict.rationale || 'See debate conclusion',
        evidence: codexEv,
      };
    } else if (codexEv.length > 0) {
      codex = {
        classification: el.claude.classification,
        rationale: 'Codex referenced this element without explicit verdict; retaining Claude classification',
        evidence: codexEv,
      };
    }

    const final = stricter(el.claude.classification, codex?.classification);
    return { ...el, codex, final };
  });
}

function stricter(a, b) {
  if (!b || !(b in STRICTER)) return a;
  if (!(a in STRICTER)) return b;
  return STRICTER[a] >= STRICTER[b] ? a : b;
}

function applyOverrides(elements, overridesStr) {
  if (!overridesStr) return elements;
  const entries = overridesStr.split(';').map(s => s.trim()).filter(Boolean);
  const overrideMap = new Map();
  for (const entry of entries) {
    const colon = entry.indexOf(':');
    if (colon < 0) continue;
    const id = entry.slice(0, colon).trim();
    const reason = entry.slice(colon + 1).trim();
    if (id && reason) overrideMap.set(id, reason);
  }
  const now = new Date().toISOString();
  return elements.map(el => {
    const reason = overrideMap.get(el.id);
    if (!reason) return el;
    return {
      ...el,
      user_override: { kept_reason: reason, timestamp: now },
    };
  });
}

function runDeterministicChecks(debate, elements, depth) {
  const roundsOk = (debate.rounds || 0) >= 2;
  const hasEvidenceCitation = elements.some(e => e.codex?.evidence?.length > 0);
  const hasExplicitStance = STANCE_RE.test(debate.conclusion || '');
  const hasThreadId = (debate.threadId || '').length > 0;
  const equilibriumRequiredMet = depth !== 'deep' || debate.equilibriumReached === true;
  const conclusionReferencesRounds = ROUND_REF_RE.test(debate.conclusion || '');
  return {
    rounds_ok: roundsOk,
    has_evidence_citation: hasEvidenceCitation,
    has_explicit_stance: hasExplicitStance,
    has_threadId: hasThreadId,
    equilibrium_required_met: equilibriumRequiredMet,
    conclusion_references_rounds: conclusionReferencesRounds,
  };
}

function findUnderCoveredDimensions(activeDimensions, debateText) {
  const DIM_NAMES = {
    1: /necessity\s+now/i,
    2: /abstraction\s+justif/i,
    3: /extensibility\s+specul/i,
    4: /configurability\s+excess/i,
    5: /premature\s+optim/i,
    6: /scope\s+drift/i,
  };
  return activeDimensions.filter(d => !DIM_NAMES[d].test(debateText || ''));
}

function aggregateDimensions(elements, activeDimensions) {
  const result = {};
  for (let d = 1; d <= 6; d++) {
    if (!activeDimensions.includes(d)) {
      result[d] = { name: DIM_NAMES[d], severity: 'Skipped', notes: 'inactive per depth' };
      continue;
    }
    const dimElems = elements.filter(e => e.primary_dimension === d);
    const cutCount = dimElems.filter(e => e.final === 'Cut').length;
    const reviewCount = dimElems.filter(e => e.final === 'Review').length;
    let severity;
    if (cutCount >= 2) severity = 'High';
    else if (cutCount === 1 || reviewCount >= 2) severity = 'Med';
    else if (reviewCount >= 1) severity = 'Low';
    else severity = 'Clean';
    result[d] = { name: DIM_NAMES[d], severity, notes: `${cutCount} Cut, ${reviewCount} Review, ${dimElems.length} total` };
  }
  return result;
}

function selectGate(elements, checks, underCovered) {
  const narrative = [];
  const checksPassed = Object.values(checks).every(v => v === true);
  if (!checksPassed) {
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    narrative.push(`⚠️ Need Human: deterministic checks failed: ${failed.join(', ')}`);
    if (underCovered.length > 0) narrative.push(`⚠️ Need Human: dimensions under-covered in debate: ${underCovered.join(', ')}`);
    return { gate: AUDIT_REVISE, narrative };
  }
  const cutElements = elements.filter(e => e.final === 'Cut');
  const overriddenCut = cutElements.filter(e => e.user_override);
  const unOverriddenCut = cutElements.filter(e => !e.user_override);

  if (unOverriddenCut.length > 0) {
    narrative.push(`⛔ ${unOverriddenCut.length} elements flagged for removal`);
    if (underCovered.length > 0) narrative.push(`⚠️ Need Human: dimensions under-covered in debate: ${underCovered.join(', ')}`);
    return { gate: AUDIT_REVISE, narrative };
  }

  if (overriddenCut.length > 0) {
    narrative.push(`ℹ️ ${overriddenCut.length} elements kept via --override with rationale`);
  }
  if (underCovered.length > 0) {
    narrative.push(`⚠️ Need Human: dimensions under-covered in debate: ${underCovered.join(', ')}`);
  }
  return { gate: AUDIT_CLEAR, narrative };
}

function consolidate({ phaseA, debate, preflight, overrides, depth }) {
  const merged = mergeVerdicts(phaseA, debate);
  const withOverrides = applyOverrides(merged, overrides);
  const checks = runDeterministicChecks(debate, withOverrides, depth);
  const underCovered = findUnderCoveredDimensions(
    preflight.activeDimensions,
    (debate.conclusion || '') + '\n' + (debate.roundsText || ''),
  );
  const dimensions = aggregateDimensions(withOverrides, preflight.activeDimensions);
  const { gate, narrative } = selectGate(withOverrides, checks, underCovered);

  return {
    schema_version: 1,
    target_path: preflight.absPath,
    relative_path: preflight.relPath,
    feature_key: preflight.featureKey,
    doc_kind: preflight.docKind,
    greenfield: preflight.greenfield,
    depth,
    preflight: preflight.skipPreflight ? 'skipped' : 'advisory',
    banners: preflight.banners || [],
    warnings: preflight.warnings || [],
    dimensions,
    elements: withOverrides,
    debate: {
      threadId: debate.threadId,
      rounds: debate.rounds,
      equilibrium_reached: debate.equilibriumReached,
      conclusion: debate.conclusion,
      skill_invocation: 'codex-brainstorm',
    },
    deterministic_checks: checks,
    under_covered_dimensions: underCovered,
    narrative,
    gate,
    suggested_next: buildSuggestedNext(withOverrides, gate),
  };
}

function buildSuggestedNext(elements, gate) {
  const suggestions = [];
  const cutUnoverridden = elements.filter(e => e.final === 'Cut' && !e.user_override);
  if (cutUnoverridden.length > 0) {
    suggestions.push(`Revise Cut elements: ${cutUnoverridden.map(e => e.id).join(', ')}`);
    suggestions.push('Or re-run with `--override <id>:<rationale>` to keep with justification');
  }
  if (gate === AUDIT_CLEAR && elements.some(e => e.final === 'Review')) {
    suggestions.push('Consider `/simplify` on Review elements for optional cleanup');
  }
  return suggestions;
}

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function main() {
  const phaseAFile = argVal('--phase-a');
  const debateFile = argVal('--debate');
  const preflightFile = argVal('--preflight');
  const overrides = argVal('--overrides') || '';
  const depth = argVal('--depth') || 'normal';
  const outputFile = argVal('--output');
  if (!phaseAFile || !debateFile || !preflightFile || !outputFile) {
    process.stderr.write('Usage: consolidate.js --phase-a <f> --debate <f> --preflight <f> [--overrides "<s>"] [--depth <d>] --output <f>\n');
    process.exit(1);
  }
  const phaseA = JSON.parse(fs.readFileSync(phaseAFile, 'utf8'));
  const debate = JSON.parse(fs.readFileSync(debateFile, 'utf8'));
  const preflight = JSON.parse(fs.readFileSync(preflightFile, 'utf8'));
  const report = consolidate({ phaseA, debate, preflight, overrides, depth });
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  mergeVerdicts,
  matchesElementId,
  escapeRegex,
  applyOverrides,
  runDeterministicChecks,
  findUnderCoveredDimensions,
  aggregateDimensions,
  selectGate,
  consolidate,
  buildSuggestedNext,
  STRICTER,
  STANCE_RE,
  ROUND_REF_RE,
  DIM_NAMES,
  AUDIT_CLEAR,
  AUDIT_REVISE,
};
