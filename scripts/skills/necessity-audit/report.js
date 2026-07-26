#!/usr/bin/env node
'use strict';

/**
 * report.js — necessity-audit Markdown / JSON report assembler.
 *
 * Output MUST start with the `## Necessity Audit` header and end with the gate sentinel
 * `consolidate.js` selected (`✅ Audit Clear` / `⛔ Audit Revise`).
 *
 * Both are BEHAVIOUR-LAYER markers: they are read by a human and by Claude's auto-loop, and by
 * nothing else. No hook parses them — see the AUDIT_CLEAR/AUDIT_REVISE comment in consolidate.js
 * for why the doc-review vocabulary (its `Document Review` header + `Mergeable` sentinel) was
 * given up. The previous version of this comment claimed the header existed "for hook parsing
 * (hooks/post-tool-review-state.sh:641)"; that was wrong in both halves — this report is never a
 * reviewer tool output, so the provenance-gated doc branch never sees it, and the cited line
 * number had drifted long before anyone noticed the claim itself was false.
 *
 * CLI:
 *   node report.js --input <file> --format markdown|json --output <file>
 */

const fs = require('fs');

const DIM_NAMES = {
  1: 'Necessity Now',
  2: 'Abstraction Justification',
  3: 'Extensibility Speculation',
  4: 'Configurability Excess',
  5: 'Premature Optimization',
  6: 'Scope Drift',
};

/**
 * Gate sentinels belonging to OTHER review planes, and the elision that defuses them.
 *
 * Renaming this report's own gate (see the AUDIT_CLEAR/AUDIT_REVISE comment in consolidate.js) fixed
 * the sentinel this assembler CHOOSES. It did nothing about the sentinels this assembler COPIES:
 * every free-text field below — banners, warnings, dimension notes, Claude/Codex rationales,
 * override reasons, the debate conclusion, narrative lines, suggested-next lines — is interpolated
 * verbatim into the output, and the output reaches the transcript. A rationale reading
 * "this abstraction is fine, the earlier review already said ✅ Mergeable" therefore hands
 * stop-guard's transcript fallback the doc verdict the rename was meant to withhold, with no
 * doc review having run. The rename narrowed the hole to a place where the CONTENT decides.
 *
 * The neutralization is applied once, to the ASSEMBLED output, rather than field by field. Field
 * lists rot: the next section added to this function is a field nobody remembers to wrap, and the
 * gap reopens silently. Sweeping the finished string cannot miss a field that did not exist when
 * the sweep was written.
 *
 * This report's own gate is unaffected — `✅ Audit Clear` / `⛔ Audit Revise` match nothing here,
 * which is the point of giving the audit its own vocabulary. If a caller ever passed a foreign
 * sentinel AS the gate, eliding it is the correct outcome too.
 */
const ELIDED = '⟨gate-sentinel elided⟩';
const ELIDED_MARKER = '⟨blocked-marker elided⟩';
// A distinct marker for the `Gate` token: reusing ELIDED_MARKER made a report say
// "the ⟨blocked-marker elided⟩ should PASS", which reads as a blocking finding in a
// sentence that was neither blocking nor about a marker.
const ELIDED_GATE_WORD = '⟨gate-word elided⟩';

const FOREIGN_GATE_SENTINELS = [
  /✅\s*Mergeable/g,          // doc review
  /⛔\s*Needs revision/g,     // doc review
  /✅\s*Plan Ready/g,         // plan review — checked before the bare code-review forms below
  /⛔\s*Plan Blocked/g,
  /✅\s*Ready/g,              // code review
  /⛔\s*Blocked/g,
  /##\s*Overall:[^\n]*/g,     // precommit
  /##\s*Document Review/g,    // doc-review header
  /##\s*Gate:/g,              // aggregate gate header
];

// stop-guard's recency scan is coarser than the sentinel list: `⛔.*(Block|Needs revision|Must
// fix)` matches ANY line carrying `⛔` and one of those words. That direction fails CLOSED (a
// spurious "review not passed"), so it cannot leak a pass — but it would let an audit narrative
// invalidate an unrelated, genuinely passing gate, which is the same class of cross-plane
// interference and the reason `⛔ Audit Revise` was chosen over `⛔ Audit Needs revision`.
//
// The other half of stop-guard's coarseness, and the one that fails OPEN. Its passing scan is
// `## Gate: ✅|✅ Mergeable|✅ Ready|Gate.*PASS` — that last alternative needs no emoji, no header
// and no colon: ANY line holding the word `Gate` with `PASS` later on it is read as a passing
// review verdict. The `##\s*Gate:` entry in the list above elides only the literal header, so an
// audit rationale reading "the Gate should PASS once the adapter is removed" went out verbatim and
// handed the transcript fallback a code-review pass that no reviewer ever emitted.
//
// Elide the `Gate` token rather than the verdict word: `PASS`/`FAIL` carry the audit's own meaning
// in prose about test outcomes, while `Gate` is the token stop-guard actually anchors on. Removing
// it breaks the match without rewriting what the sentence says. `FAIL` gets the same treatment even
// though `Gate.*FAIL` fails CLOSED — an audit narrative must not be able to invalidate an unrelated
// passing gate either, which is the same cross-plane interference the `⛔` rule exists for.
//
// This report's own `### Gate` header survives: it carries neither word on its line.

/**
 * Both coarse rules were once single regexes — `/⛔(?=[^\n]*(?:Block|…))/g` and
 * `/Gate(?=[^\n]*(?:PASS|FAIL))/g`. Both ask the same question ("is there a trigger word later on
 * this line?") and a `(?=[^\n]*…)` lookahead answers it by re-scanning to end-of-line ONCE PER
 * TOKEN. That is quadratic in tokens-per-line, and measurably so: one line of 40 000 tokens took
 * 533 ms for `⛔` and 1 314 ms for `Gate` (the latter worse only because `Gate` is four characters
 * of scanning per attempt). Reports are assembled from free text that a caller controls, and the
 * JSON branch sweeps every string in the structure, so line length is bounded by nothing here.
 *
 * This computes the answer ONCE for the whole input instead: find where the last trigger starts,
 * then keep only the tokens that end at or before it. Semantics are preserved exactly — a token is
 * elided iff a trigger occurs AFTER it, which is what the lookahead meant.
 *
 * The input is the WHOLE text, not one line: see `neutralizeForeignGates` for why the line was the
 * wrong unit. The ordering rule is what keeps that widening safe — the alternative simplification
 * ("elide on any trigger anywhere") would elide `⛔ Audit Revise` whenever the document said
 * "Must fix" earlier, and the audit's own vocabulary surviving is a property this module is tested
 * on. Because a token is elided only when a trigger FOLLOWS it, and the gate sentinel is the last
 * line of the report by contract, widening the window cannot reach it.
 */
function _elideBeforeTrigger(line, tokenRe, triggerRe, marker) {
  let lastTriggerStart = -1;
  triggerRe.lastIndex = 0;
  let m;
  while ((m = triggerRe.exec(line)) !== null) {
    lastTriggerStart = m.index;
    if (m.index === triggerRe.lastIndex) triggerRe.lastIndex += 1; // zero-width guard
  }
  if (lastTriggerStart < 0) return line;
  tokenRe.lastIndex = 0;
  return line.replace(tokenRe, (tok, offset) =>
    (offset + tok.length <= lastTriggerStart ? marker : tok));
}

const COARSE_BLOCK_TOKEN = /⛔/g;
const COARSE_BLOCK_TRIGGER = /Block|Needs revision|Must fix/g;
const COARSE_GATE_TOKEN = /Gate/g;
const COARSE_GATE_TRIGGER = /PASS|FAIL/g;

/**
 * The coarse passes run over the WHOLE text, not line by line.
 *
 * Per-line was the wrong unit, and the reason is what stop-guard actually reads: `tail -500` of a
 * JSONL transcript. A report reaches it inside a JSON string, where `JSON.stringify` has encoded
 * every real newline as the two characters `\` `n` — so the entire report is ONE line to `grep`.
 * Reproduced directly: a report with `⛔` on line 3 and `Block` on line 4 matched NEITHER coarse
 * pattern as plain multi-line text (correctly elided), and matched BOTH once encoded. The `Gate`
 * one is the fail-OPEN half — `Gate.*PASS` needs no emoji, header or colon, so an audit narrative
 * saying "The Gate below is advisory … the audit should PASS" is read by the transcript fallback
 * as a passing CODE REVIEW verdict for a gate nobody ran.
 *
 * Widening the scope does NOT threaten this report's own vocabulary, which was the stated reason
 * for keeping it narrow. `⛔ Audit Revise` is terminal by contract — `references/output-template.md`
 * requires the gate to be the last line, "nothing else" — so no trigger word can follow it, and a
 * token is still elided only when a trigger occurs AFTER it.
 */
function neutralizeForeignGates(text) {
  let out = text;
  for (const re of FOREIGN_GATE_SENTINELS) out = out.replace(re, ELIDED);
  // Order matters only in that each pass re-measures the text it is given; the markers carry none
  // of the other pass's tokens, so neither can manufacture or mask a match for the other.
  out = _elideBeforeTrigger(out, COARSE_BLOCK_TOKEN, COARSE_BLOCK_TRIGGER, ELIDED_MARKER);
  out = _elideBeforeTrigger(out, COARSE_GATE_TOKEN, COARSE_GATE_TRIGGER, ELIDED_GATE_WORD);
  return out;
}

/**
 * The coarse sweep, re-run on ALREADY-SERIALIZED JSON.
 *
 * `neutralizeJsonValues` cleans each string in isolation, which is exactly right for the sentinel
 * list (a greedy `##\s*Overall:[^\n]*` applied to serialized text eats the closing quote and comma
 * — see its doc comment) and exactly insufficient for the coarse pair. `JSON.stringify` puts every
 * field into one document, so `Gate` in one value and `PASS` in another land on the same grep line
 * with nothing between them but syntax. No amount of per-value cleaning can see that.
 *
 * Safe to run on serialized text where the sentinel list is not: both tokens are fixed-width with
 * no greedy tail, so nothing beyond the token itself is consumed, and the replacement markers
 * contain no `"` and no `\` — the two characters that could break a JSON string. JSON has no bare
 * identifiers, so a match is always inside a string literal.
 */
function neutralizeSerializedCoarse(json) {
  let out = _elideBeforeTrigger(json, COARSE_BLOCK_TOKEN, COARSE_BLOCK_TRIGGER, ELIDED_MARKER);
  out = _elideBeforeTrigger(out, COARSE_GATE_TOKEN, COARSE_GATE_TRIGGER, ELIDED_GATE_WORD);
  return out;
}

/**
 * Neutralize every string in a report BEFORE it is serialized.
 *
 * The JSON branch used to sweep the SERIALIZED text, which quietly broke the format it was
 * protecting. `##\s*Overall:[^\n]*` runs to the end of a line, and in serialized JSON a string's
 * closing quote and its trailing comma are on that same line — a value of `"## Overall: ✅ PASS"`
 * came out as `"⟨gate-sentinel elided⟩` with the quote and comma consumed, and `JSON.parse`
 * rejected the file. Worse for the sweep's own purpose: `JSON.stringify` escapes newlines as
 * `\n` (two characters), so `[^\n]*` never stopped at an embedded line break and ran on through
 * neighbouring fields.
 *
 * Operating on the values instead is both correct and stricter — a sentinel is elided wherever it
 * sits in the structure, and the serializer is left to produce valid JSON from already-clean data.
 * Keys are swept too: a caller controls those in the free-form maps (`deterministic_checks`), and
 * a sentinel in a key reaches a transcript grep exactly like one in a value.
 */
function neutralizeJsonValues(value) {
  if (typeof value === 'string') return neutralizeForeignGates(value);
  if (Array.isArray(value)) return value.map(neutralizeJsonValues);
  if (value && typeof value === 'object') {
    // `Object.create(null)` + `defineProperty`, not `{}` + assignment. `JSON.parse` creates
    // `__proto__` as an ORDINARY own property, so it arrives here like any other key — but plain
    // assignment on a `{}` literal hits the inherited `__proto__` SETTER instead of creating a
    // property. The entry then vanishes from the output entirely (and, when its value is an
    // object, silently becomes the result's prototype). Dropping a field is not a safe failure
    // here: this function's whole job is to sanitize the report, and a field that disappears was
    // never sanitized — it was just moved somewhere the sweep does not look.
    const out = Object.create(null);
    const used = new Set();
    for (const [k, v] of Object.entries(value)) {
      let key = neutralizeForeignGates(k);
      // Neutralizing is many-to-one — two distinct keys carrying different sentinels can elide to
      // the same text — and assigning both would silently keep only the last. `deterministic_checks`
      // is a caller-controlled free-form map, so distinct keys colliding is reachable, not
      // hypothetical. Suffix rather than overwrite: the report stays lossless and the duplicate is
      // visible to a reader instead of being one silently missing row.
      if (used.has(key)) {
        let n = 2;
        while (used.has(`${key} ⟨dup:${n}⟩`)) n += 1;
        key = `${key} ⟨dup:${n}⟩`;
      }
      used.add(key);
      Object.defineProperty(out, key, {
        value: neutralizeJsonValues(v),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('## Necessity Audit');
  lines.push('');

  for (const banner of report.banners || []) lines.push(`**${banner}**`);
  if ((report.banners || []).length > 0) lines.push('');

  lines.push(`**Target**: \`${report.relative_path}\``);
  lines.push(`**Feature**: \`${report.feature_key}\` (greenfield: ${report.greenfield})`);
  lines.push(`**Depth**: ${report.depth} · **Preflight**: ${report.preflight}`);
  lines.push(`**Schema**: v${report.schema_version}`);
  lines.push('');

  for (const warning of report.warnings || []) lines.push(`> ${warning}`);
  if ((report.warnings || []).length > 0) lines.push('');

  lines.push('### Dimension Overview');
  lines.push('');
  lines.push('| # | Dimension | Severity | Notes |');
  lines.push('|---|-----------|----------|-------|');
  for (let d = 1; d <= 6; d++) {
    const dim = report.dimensions[d];
    if (!dim) continue;
    lines.push(`| ${d} | ${DIM_NAMES[d]} | ${dim.severity} | ${dim.notes} |`);
  }
  lines.push('');

  lines.push('### Classification');
  lines.push('');
  const byFinal = { Keep: [], Review: [], Cut: [] };
  for (const el of report.elements) {
    const bucket = ['Keep', 'Review', 'Cut'].includes(el.final) ? el.final : 'Review';
    byFinal[bucket].push(el);
  }

  lines.push(`#### Keep (${byFinal.Keep.length} items)`);
  if (byFinal.Keep.length > 0) {
    lines.push('');
    lines.push('| ID | Kind | Rationale |');
    lines.push('|----|------|-----------|');
    for (const el of byFinal.Keep) {
      lines.push(`| ${el.id} | ${el.kind} | ${compact(el.claude.rationale)} |`);
    }
  }
  lines.push('');

  lines.push(`#### Review (${byFinal.Review.length} items)`);
  if (byFinal.Review.length > 0) {
    lines.push('');
    lines.push('| ID | Kind | Dim | Claude | Codex | Evidence |');
    lines.push('|----|------|-----|--------|-------|----------|');
    for (const el of byFinal.Review) {
      const ev = (el.codex?.evidence?.[0]?.location) || (el.evidence?.[0]?.location) || '—';
      lines.push(`| ${el.id} | ${el.kind} | ${el.primary_dimension} | ${el.claude.classification} | ${el.codex?.classification || '—'} | \`${ev}\` |`);
    }
  }
  lines.push('');

  lines.push(`#### Cut (${byFinal.Cut.length} items — unless overridden)`);
  if (byFinal.Cut.length > 0) {
    lines.push('');
    lines.push('| ID | Kind | Dim | Codex rationale | Evidence | Override? |');
    lines.push('|----|------|-----|-----------------|----------|-----------|');
    for (const el of byFinal.Cut) {
      const ev = (el.codex?.evidence?.[0]?.location) || (el.evidence?.[0]?.location) || '—';
      const override = el.user_override ? `✅ "${compact(el.user_override.kept_reason)}"` : '❌';
      lines.push(`| ${el.id} | ${el.kind} | ${el.primary_dimension} | ${compact(el.codex?.rationale || el.claude.rationale)} | \`${ev}\` | ${override} |`);
    }
  }
  lines.push('');

  lines.push('### Debate');
  lines.push('');
  lines.push(`- **Thread**: \`${report.debate.threadId || '(none)'}\` (provider: ${report.debate.skill_invocation})`);
  lines.push(`- **Rounds**: ${report.debate.rounds} · **Equilibrium**: ${report.debate.equilibrium_reached ? '✅' : '❌'}`);
  lines.push(`- **Conclusion**: ${compact(report.debate.conclusion, 300)}`);
  lines.push('');

  lines.push('### Deterministic Checks (NFR-10)');
  lines.push('');
  lines.push('| Check | Result |');
  lines.push('|-------|--------|');
  for (const [k, v] of Object.entries(report.deterministic_checks)) {
    lines.push(`| ${k} | ${v ? '✅' : '❌'} |`);
  }
  lines.push('');

  if (report.under_covered_dimensions.length > 0) {
    lines.push(`**Under-covered dimensions**: ${report.under_covered_dimensions.map(d => `${d} (${DIM_NAMES[d]})`).join(', ')}`);
    lines.push('');
  }

  if (report.narrative.length > 0) {
    lines.push('### Narrative');
    lines.push('');
    for (const n of report.narrative) lines.push(`- ${n}`);
    lines.push('');
  }

  if (report.suggested_next.length > 0) {
    lines.push('### Suggested Next');
    lines.push('');
    for (const s of report.suggested_next) lines.push(`- ${s}`);
    lines.push('');
  }

  lines.push('### Gate');
  lines.push('');
  lines.push(report.gate);
  lines.push('');

  return neutralizeForeignGates(lines.join('\n'));
}

function compact(text, max = 140) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function main() {
  const inputFile = argVal('--input');
  const format = argVal('--format') || 'markdown';
  const outputFile = argVal('--output');
  if (!inputFile || !outputFile) {
    process.stderr.write('Usage: report.js --input <file> [--format markdown|json] --output <file>\n');
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  // The JSON form carries the same free text and is read back the same way, so it gets the same
  // sweep — but applied to the VALUES, before serialization. Sweeping the serialized text instead
  // destroyed the syntax it was meant to leave intact (see neutralizeJsonValues).
  const out = format === 'json'
    // Two passes, because they close different holes: per-value for the sentinel list (a greedy
    // pattern would destroy the syntax if run on serialized text), then the coarse pair over the
    // finished document, which is the only place a `Gate` in one field and a `PASS` in another are
    // visible as the single line a transcript grep will see them as.
    ? neutralizeSerializedCoarse(JSON.stringify(neutralizeJsonValues(report), null, 2))
    : buildMarkdown(report);
  fs.writeFileSync(outputFile, out);
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  buildMarkdown,
  compact,
  neutralizeForeignGates,
  neutralizeJsonValues,
  neutralizeSerializedCoarse,
  DIM_NAMES,
};
