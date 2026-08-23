#!/usr/bin/env node
'use strict';

/**
 * Fail-closed raw-terminal validator for fallback review reports (review-loop-resilience).
 *
 * Usage: node scripts/validate-family-sentinel.js <contract>   (report on stdin)
 * Exit 0 ⇔ the report carries exactly one legal raw terminal for the named contract and no
 * terminal of any other contract. Everything else — zero terminals, two terminals, a foreign
 * family's terminal, empty or unreadable input, an unknown contract — exits 1. A terminal is
 * never translated across contracts here or anywhere: a failing report fails this carrier.
 *
 * The raw layer is what the dispatched carrier emitted. Families with a raw→public derivation
 * (test:ac-trace) validate the raw form; the public form is produced by the owning skill's own
 * clause. Contract: docs/features/review-loop-resilience/2-tech-spec.md §3.2.
 *
 * Occurrence rules — a terminal counts only in report prose, and only where a verdict line
 * lives: fenced code blocks (``` / ~~~, any run length >= 3), blockquote lines (leading `>`)
 * and inline code spans (backtick runs of any width) are stripped before matching, and a
 * sentinel then counts only when it BEGINS its line (after optional heading `#` markers or a
 * `**` bold opener) and ENDS at a boundary (end-of-line or a non-word character). Prose that merely mentions a sentinel mid-line — "the report is not
 * ✅ Ready" — is not a verdict; a report may likewise *quote* another family's sentinel without
 * forging its verdict. Indented content never reaches column 0, so indented code blocks cannot
 * produce a countable terminal either.
 */

const CONTRACTS = {
  // `shape` (round-12 P1) encodes WHERE each family template puts its terminal — enforced by
  // checkShape() after the occurrence checks, sources: review-loop-doc.md § Gate,
  // codex-prompt-test-review.md, codex-prompt-ac-trace.md, codex-prompt-plan.md § Gate.
  // `code` deliberately has none: its templates allow a headed/trailing-text gate section.
  code: { sentinels: ['✅ Ready', '⛔ Blocked'] },
  doc: { sentinels: ['✅ Mergeable', '⛔ Needs revision'], shape: { bareFinal: true } },
  plan: {
    // A dispatched carrier may emit only ✅/⛔ (codex-prompt-plan.md authorizes nothing else).
    // ⚠️ Plan Needs Human (round-cap, owning-skill derivation), [PLAN_REVIEW_DEGRADED]
    // (Priority-4 / secret-detected, dispatcher-owned) and [PLAN_REVIEW_SKIPPED] (explicit user
    // intent, owning-skill-owned) are orchestration-owned: they still count as plan-family
    // terminals for occurrence and cross-family checks, and a carrier report carrying one
    // ANYWHERE in unquoted prose fails validation (see the substring scan in validate()) — the
    // owning skill reads these machine tokens before verdict markers, so a defective P2 carrier
    // must not be able to fake exhaustion, a skip, or a round-cap hand-off and dodge the P3
    // retry, whether the token is a verdict line or rides mid-line beside a valid one.
    sentinels: ['✅ Plan Ready', '⛔ Plan Blocked', '⚠️ Plan Needs Human', '[PLAN_REVIEW_DEGRADED]', '[PLAN_REVIEW_SKIPPED]'],
    orchestrationOnly: ['⚠️ Plan Needs Human', '[PLAN_REVIEW_DEGRADED]', '[PLAN_REVIEW_SKIPPED]'],
    shape: { bareFinal: true, headerBefore: '## Plan Review' },
  },
  'test:coverage': {
    // Alias union: both historical shapes carry the same pass/fail semantics. Each report must
    // still carry exactly one terminal — mixing aliases is rejected, and no canonicalization is
    // performed (the sentinels themselves stay untouched).
    sentinels: ['✅ Tests sufficient', '⛔ Tests need supplementation', '✅ Sufficient', '⛔ Needs additions'],
    shape: { bareFinal: true },
  },
  'test:ac-trace': {
    // Line-anchored like the sentinel families: the raw gate line is a top-level or list-item
    // line, so only a line beginning `gate:` (after an optional `-`/`*` bullet or `**`) counts.
    // No `\b` here — JavaScript's \b is ASCII-only, so `gate: Adequate外` would slip through
    // it; the Unicode end-boundary check lives in countTerminals, shared with the sentinels.
    regex: /^(?:[-*]\s+)?(?:\*\*)?gate:\s*(Adequate_with_exceptions|Adequate|Need_Human|Inadequate)/,
    // Detection above stays loose (bulleted/bold forms still count as ac-trace terminals for
    // occurrence and cross-family checks); the SHAPE the template mandates is stricter.
    shape: { finalRegex: /^gate:\s*(Adequate_with_exceptions|Adequate|Need_Human|Inadequate)$/ },
  },
};

const CONTRACT_NAMES = Object.keys(CONTRACTS);

/**
 * Strip fenced code blocks, blockquotes, indented code and inline code spans.
 * CommonMark-lite, in the directions that matter for verdict counting:
 * - a fence opens only at 0-3 spaces of indentation (4+ is an indented code block, not a fence)
 *   and may carry an info string; it closes only on a delimiter-only line (same character, run
 *   length >= the opening run, nothing but trailing spaces);
 * - blockquote lines and 4+-space-indented lines are dropped whole — neither can carry a
 *   column-0 verdict, and dropping indented code keeps its backticks out of span pairing;
 * - inline code spans pair backtick runs of equal length and MAY CROSS LINE ENDINGS, so the
 *   span scan runs over the joined survivor text, not per line.
 */
function stripQuoted(text) {
  const out = [];
  let fenceChar = null; // '`' or '~' while inside a fence
  let fenceLen = 0;
  for (const line of text.split('\n')) {
    if (fenceChar !== null) {
      // Only a delimiter-only line of the same character and >= opening length closes.
      const closer = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (closer && closer[1][0] === fenceChar && closer[1].length >= fenceLen) {
        fenceChar = null; fenceLen = 0;
      }
      continue;
    }
    const opener = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // CommonMark: a BACKTICK fence's info string may not contain a backtick — a line like
    // ```example``` is an inline code span, not a fence opener. Tilde info strings are free.
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      fenceChar = opener[1][0]; fenceLen = opener[1].length;
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    if (/^(?: {4,}|\t)/.test(line)) continue;
    out.push(line);
  }
  return maskInlineSpans(out.join('\n'));
}

/**
 * Mask inline code spans in place. CommonMark pairing: a code span opens with a maximal
 * backtick run and closes with the NEXT maximal run of exactly equal length; runs of other
 * lengths in between are content, an opener with no equal-length closer is literal text, and
 * a span cannot contain a blank line. Span characters are masked to spaces (newlines kept), so
 * line and column positions survive — deleting the span would splice its suffix to the line
 * head and could forge a line-initial verdict out of mid-line text.
 */
function maskInlineSpans(text) {
  const runs = [];
  const re = /`+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // A run preceded by an odd number of backslashes is escaped prose and cannot OPEN a span
    // (CommonMark). It can still CLOSE one: inside a code span backslashes are literal, so the
    // escape has no force there — the flag is consulted only when the run is an opener candidate.
    let bs = 0;
    for (let k = m.index - 1; k >= 0 && text[k] === '\\'; k -= 1) bs += 1;
    runs.push({ start: m.index, len: m[0].length, escaped: bs % 2 === 1 });
  }
  const chars = text.split('');
  let i = 0;
  while (i < runs.length) {
    const open = runs[i];
    if (open.escaped) { i += 1; continue; }
    let j = i + 1;
    while (j < runs.length && runs[j].len !== open.len) j += 1;
    const closes = j < runs.length
      && !/\n[ \t]*\n/.test(text.slice(open.start + open.len, runs[j].start));
    if (closes) {
      const end = runs[j].start + runs[j].len;
      for (let k = open.start; k < end; k += 1) {
        if (chars[k] !== '\n') chars[k] = ' ';
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return chars.join('');
}

/**
 * Count line-anchored occurrences of each contract's terminals in stripped prose. A verdict is
 * a line that BEGINS with the terminal — an optional markdown heading (`#{1,6} `) or a `**`
 * bold opener may precede it; trailing text after the terminal ("⛔ Blocked: three findings")
 * is fine, but a verdict line is then scanned whole, so a second terminal sharing the line is
 * counted (fail-closed against one-line dual/cross forgeries). A sentinel appearing mid-line
 * on a NON-verdict line is prose, not a verdict.
 */
function countTerminals(prose) {
  const counts = {};
  for (const name of CONTRACT_NAMES) counts[name] = 0;
  for (const rawLine of prose.split('\n')) {
    const line = rawLine.replace(/^#{1,6}\s+/, '').replace(/^\*\*/, '');
    let initialLen = 0;
    let initialName = null;
    for (const name of CONTRACT_NAMES) {
      const spec = CONTRACTS[name];
      if (spec.sentinels) {
        for (const s of spec.sentinels) {
          if (line.startsWith(s) && endsAtBoundary(line, s.length)) {
            counts[name] += 1; initialLen = s.length; initialName = name; break;
          }
        }
      } else {
        const m = spec.regex.exec(line);
        if (m && endsAtBoundary(line, m[0].length)) {
          counts[name] += 1; initialLen = m[0].length; initialName = name;
        }
      }
      if (initialName !== null) break;
    }
    // A verdict line is scanned to its end: a SECOND terminal on the same line — own or
    // foreign — is counted too, so "✅ Ready / ⛔ Blocked" or "✅ Ready / ✅ Mergeable" reads
    // as ambiguous/cross-contract instead of a clean verdict. Non-verdict lines keep their
    // prose immunity (a mid-line mention alone never counts).
    if (initialName !== null && initialLen < line.length) {
      const rest = line.slice(initialLen);
      for (const name of CONTRACT_NAMES) {
        const spec = CONTRACTS[name];
        if (spec.sentinels) {
          for (const s of spec.sentinels) {
            let idx = 0;
            while ((idx = rest.indexOf(s, idx)) !== -1) {
              if (startsAtBoundary(rest, idx) && endsAtBoundary(rest, idx + s.length)) counts[name] += 1;
              idx += s.length;
            }
          }
        } else {
          const m = /(?:^|[^\p{L}\p{N}_])gate:\s*(Adequate_with_exceptions|Adequate|Need_Human|Inadequate)/u.exec(rest);
          if (m && endsAtBoundary(rest, m.index + m[0].length)) counts[name] += 1;
        }
      }
    }
  }
  return counts;
}

/** True when position `pos` in `text` sits after a non-word character (or line start). */
function startsAtBoundary(text, pos) {
  return pos === 0 || /[^\p{L}\p{N}_]/u.test(text[pos - 1]);
}

/** True when the char at `pos` (the first after a terminal) is a Unicode word boundary. */
function endsAtBoundary(text, pos) {
  return pos >= text.length || /^[^\p{L}\p{N}_]/u.test(text.slice(pos));
}

/**
 * Enforce the family template's raw report shape (round-12/13 P1): the occurrence checks prove
 * one legal terminal EXISTS, this proves it sits where the template puts it — a mid-report or
 * headed verdict line is prose the template forbids, and adopting it would let non-verdict text
 * close the fallback gate. Runs on the CRLF-normalized RAW report, NOT the quote-stripped prose:
 * stripping deletes fenced/blockquoted/indented content, so a fence AFTER the verdict would
 * vanish and the verdict would masquerade as the final line (round-13). Line comparison is
 * exact — no trailing-space trimming, and only truly empty lines are skipped as blank, per the
 * templates' "alone on the final line" contract. Contracts without `shape` (code) skip.
 * @returns {string|null} rejection reason, or null when the shape holds
 */
function checkShape(contract, rawNormalized) {
  const spec = CONTRACTS[contract];
  if (!spec.shape) return null;
  const lines = rawNormalized.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && lines[last] === '') last -= 1;
  if (last < 0) return 'no final verdict line';
  const finalLine = lines[last];
  if (spec.shape.finalRegex) {
    if (!spec.shape.finalRegex.test(finalLine)) {
      return 'terminal is not the bare final line the family template requires';
    }
  } else {
    const carrier = (spec.sentinels || []).filter((s) => !(spec.orchestrationOnly || []).includes(s));
    if (!carrier.includes(finalLine)) {
      return 'terminal is not the bare final line the family template requires';
    }
  }
  if (spec.shape.headerBefore) {
    let prev = last - 1;
    while (prev >= 0 && lines[prev] === '') prev -= 1;
    const prevLine = prev >= 0 ? lines[prev] : '';
    if (prevLine !== spec.shape.headerBefore) {
      return `missing \`${spec.shape.headerBefore}\` discriminator directly before the verdict`;
    }
  }
  return null;
}

/**
 * Validate a raw report against one contract.
 * @returns {{ok: boolean, reason: string}}
 */
function validate(contract, report) {
  if (!CONTRACT_NAMES.includes(contract)) return { ok: false, reason: `unknown contract: ${contract}` };
  if (typeof report !== 'string' || report.trim() === '') return { ok: false, reason: 'empty report' };
  // Normalize CRLF / bare CR before any structural scan: a \r inside a "blank" line would
  // defeat the span blank-line guard, and a trailing \r would ride along on every line.
  const normalized = report.replace(/\r\n?/g, '\n');
  const prose = stripQuoted(normalized);
  const counts = countTerminals(prose);
  const own = counts[contract];
  const foreign = CONTRACT_NAMES.filter((n) => n !== contract && counts[n] > 0);
  if (foreign.length > 0) return { ok: false, reason: `foreign terminal (${foreign.join(', ')}) — never translated across contracts` };
  if (own === 0) return { ok: false, reason: 'no legal terminal for this contract' };
  if (own > 1) return { ok: false, reason: `ambiguous: ${own} terminals, exactly one required` };
  // Orchestration-owned tokens are machine tokens, not verdicts: the owning skill's verdict
  // precedence reads them ANYWHERE in reviewer output, before verdict markers
  // (plan-review/SKILL.md § verdict precedence). So the scan here is a substring scan over the
  // whole stripped prose — not verdict-line anchoring — or a carrier could ride a valid verdict
  // line and still fake exhaustion with a mid-line `status: [PLAN_REVIEW_DEGRADED]`. Quoting
  // stays safe: fenced/blockquoted/inline-code occurrences were masked by stripQuoted above.
  const orchTokens = CONTRACTS[contract].orchestrationOnly || [];
  const orchHit = orchTokens.find((t) => prose.includes(t));
  if (orchHit !== undefined) {
    return { ok: false, reason: `orchestration-owned token (${orchHit}) — a dispatched carrier may not emit it` };
  }
  const shapeErr = checkShape(contract, normalized);
  if (shapeErr !== null) return { ok: false, reason: shapeErr };
  return { ok: true, reason: 'exactly one legal terminal' };
}

function main() {
  const contract = process.argv[2];
  if (!contract) {
    process.stderr.write('usage: validate-family-sentinel.js <contract>  (report on stdin)\n');
    process.exit(1);
  }
  let input = '';
  try {
    input = require('node:fs').readFileSync(0, 'utf8');
  } catch {
    process.stderr.write('[SENTINEL_INVALID] unreadable stdin\n');
    process.exit(1);
  }
  const { ok, reason } = validate(contract, input);
  if (ok) {
    process.stdout.write(`[SENTINEL_VALID] contract=${contract}\n`);
    process.exit(0);
  }
  process.stderr.write(`[SENTINEL_INVALID] contract=${contract} reason=${reason}\n`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { validate, CONTRACTS, CONTRACT_NAMES };
