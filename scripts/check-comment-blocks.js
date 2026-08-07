#!/usr/bin/env node
/**
 * check-comment-blocks.js
 * Enforces rules/docs-writing.md § Code Comments: a logical comment block in
 * .sh/.js sources must stay under 30 comment lines (25–29 draws a warning).
 * Blank lines bridge a block rather than splitting it, and a directive/license
 * exemption covers only the contiguous run it heads — not what a bridge pulls
 * in after it. Long rationale belongs in docs/features/<feature>/ with a
 * pointer comment naming the doc section.
 *
 * Usage:
 *   node scripts/check-comment-blocks.js [--root <dir>] [--json]
 *
 * Scans hooks/ scripts/ skills/ under --root (default: cwd) recursively.
 * Exit codes: 0 = no blocking block (warnings may print) · 1 = ≥1 block of
 * 30+ lines · 2 = usage error
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BLOCK_THRESHOLD = 30; // ≥30 comment lines in one logical block → blocking
const WARN_THRESHOLD = 25; // 25–29 → warning only

const SCAN_DIRS = ['hooks', 'scripts', 'skills'];
const SCAN_EXTS = new Set(['.sh', '.js']);

// Directory-name exemptions (matched at ANY depth): generated or vendored trees.
const EXEMPT_DIR_NAMES = new Set(['node_modules', '.claude', 'dist', 'vendor']);

// Block-content exemptions: a block whose FIRST line matches any of these has
// the run that line heads skipped (license headers, lint/compiler directive
// stacks). Only that run — see `measurable`.
const EXEMPT_FIRST_LINE = [
  /SPDX-License-Identifier/,
  /Copyright\s+(\(c\)|©|\d{4})/i,
  /eslint-disable/,
  /shellcheck\s+disable/,
];

// A comment line, per language. Shell has NO `/* */` form: treating one as a
// comment makes `case $x in /*)` open a block state that swallows the rest of
// the file (35 lines of executable shell reported as one comment block), and
// makes a `*)` default arm read as a comment line. `auto` is the permissive
// union, for callers holding mixed or unknown-syntax content — `scan()` never
// uses it, because a real file always has an extension to dispatch on.
const COMMENT_BY_LANG = {
  sh: /^[\s]*#/,
  js: /^[\s]*(\/\/|\/\*|\*)/,
  auto: /^[\s]*(#|\/\/|\/\*|\*)/,
};

const BLANK_LINE = /^[\s]*$/;

/** Language key for a path: shell by extension, JS otherwise. */
function langFor(file) {
  return path.extname(file) === '.sh' ? 'sh' : 'js';
}

/**
 * Find logical comment blocks in file content.
 * Returns [{ line, count }] — 1-based start line + comment-line count.
 *
 * "Logical", not "contiguous": blank lines BRIDGE a block rather than ending it.
 * The metric is how much explanation a reader crosses before reaching the code
 * it explains, and whitespace is not a break in that payload — under the old
 * contiguous rule a single blank line split a 51-line header into two compliant
 * runs, making the threshold avoidable at zero cost. Blank lines bridge but are
 * not counted; only comment lines add to `count`. A block still ends at the
 * first executable/declarative line.
 *
 * Stateful across JS block comments: a line starting with an unclosed `/*` puts
 * the scanner in-block, and every physical line until the closing star-slash
 * counts as a comment line even without a `*` prefix — otherwise `/*` + 28 bare
 * rationale lines + close would read as two one-line blocks (fail-open).
 * Only a line-INITIAL `/*` opens the state, so a `//` line that merely contains
 * `/*` (e.g. a glob like `src/*`) cannot trap the scanner. Shell never enters
 * this state at all — see COMMENT_BY_LANG.
 */
function findBlocks(content, lang = 'auto') {
  const commentRe = COMMENT_BY_LANG[lang] || COMMENT_BY_LANG.auto;
  const cBlockComments = lang !== 'sh';
  const blocks = [];
  let start = 0;
  let count = 0;
  // Bridging and the first-line exemption interact, and the interaction is a hole if left
  // implicit: a one-line `// SPDX-License-Identifier: …` bridged into 60 rationale lines heads an
  // exempt block, so the whole run goes unmeasured — a licence header launders arbitrary
  // explanation at the cost of one blank line. `headRun` is the contiguous comment run the
  // exemption actually covers, and `restLine` is where the bridged remainder begins, so `scan` can
  // exempt the header and still measure what follows it. Without a bridge the two are (count, 0)
  // and the exemption behaves exactly as `rules/docs-writing.md` describes.
  let headRun = 0;
  let restLine = 0;
  let bridged = false;
  let inBlock = false;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let isComment;
    if (inBlock) {
      isComment = true;
      if (line.includes('*/')) inBlock = false;
    } else {
      isComment = commentRe.test(line);
      if (cBlockComments && isComment && /^\s*\/\*/.test(line)) {
        const open = line.indexOf('/*');
        if (line.indexOf('*/', open + 2) === -1) inBlock = true;
      }
    }
    if (isComment) {
      if (count === 0) {
        start = i + 1;
        headRun = 0;
        restLine = 0;
        bridged = false;
      }
      count++;
      if (bridged) {
        if (restLine === 0) restLine = i + 1;
      } else {
        headRun++;
      }
    } else if (count > 0 && BLANK_LINE.test(line)) {
      // Bridge, do not close — see the "logical, not contiguous" note above. A second or third
      // blank changes nothing: `bridged` latches, so the exemption covers the FIRST run only and
      // every later run is part of the measured remainder.
      bridged = true;
      continue;
    } else {
      if (count > 0) blocks.push({ line: start, count, headRun, restLine });
      count = 0;
    }
  }
  if (count > 0) blocks.push({ line: start, count, headRun, restLine });
  return blocks;
}

/** Severity for a block length: 'block' | 'warn' | null. */
function classify(count) {
  if (count >= BLOCK_THRESHOLD) return 'block';
  if (count >= WARN_THRESHOLD) return 'warn';
  return null;
}

/**
 * True if the block is headed by an exempt license/directive line.
 *
 * Headed, not covered: with bridging, an exempt first line and the rationale below it can be one
 * block, and this answers only whether the HEAD is exempt. `measurable` is what turns that into a
 * count.
 */
function isExemptBlock(content, block) {
  const first = content.split('\n')[block.line - 1] || '';
  return EXEMPT_FIRST_LINE.some((re) => re.test(first));
}

/**
 * The part of a block the thresholds apply to: the whole block, or — when an exempt directive
 * heads it — only the bridged remainder below that header. Returns null when nothing is left to
 * measure (an unbridged exempt header, i.e. the plain case the exemption was written for).
 */
function measurable(content, block) {
  if (!isExemptBlock(content, block)) return block;
  if (!block.restLine) return null;
  return { line: block.restLine, count: block.count - block.headRun };
}

/** Recursively list scan-eligible files under root (relative paths, sorted). */
function listFiles(root) {
  const out = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    walk(abs);
  }
  function walk(abs) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory() && EXEMPT_DIR_NAMES.has(entry.name)) continue; // any depth
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && SCAN_EXTS.has(path.extname(entry.name))) out.push(path.relative(root, child));
    }
  }
  return out.sort();
}

/** Scan every eligible file; return findings [{ file, line, count, severity }]. */
function scan(root) {
  const findings = [];
  for (const rel of listFiles(root)) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const block of findBlocks(content, langFor(rel))) {
      // Exemption BEFORE classification, and it may shrink the block rather than drop it: a
      // directive header bridged into rationale leaves the rationale measurable, anchored at its
      // own first line so the report points at the run a reader would have to migrate.
      const m = measurable(content, block);
      if (!m) continue;
      const severity = classify(m.count);
      if (!severity) continue;
      findings.push({ file: rel, line: m.line, count: m.count, severity });
    }
  }
  return findings;
}

function main(argv) {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const v = argv[++i];
      if (!v) {
        process.stderr.write('Error: --root requires a value\n');
        return 2;
      }
      root = path.resolve(v);
    } else if (argv[i] === '--json') {
      json = true;
    } else {
      process.stderr.write(`Error: unknown flag ${argv[i]}\nUsage: node scripts/check-comment-blocks.js [--root <dir>] [--json]\n`);
      return 2;
    }
  }

  // A mistyped root scanning nothing must not read as a clean repo (fail-open).
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    process.stderr.write(`Error: --root ${root} is not a directory\n`);
    return 2;
  }
  if (!SCAN_DIRS.some((d) => fs.existsSync(path.join(root, d)))) {
    process.stderr.write(`Error: none of ${SCAN_DIRS.join('/')} exist under ${root} — wrong root?\n`);
    return 2;
  }

  const findings = scan(root);
  const blocking = findings.filter((f) => f.severity === 'block');
  const warnings = findings.filter((f) => f.severity === 'warn');

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: blocking.length === 0, blocking, warnings }, null, 2)}\n`);
  } else {
    for (const f of blocking) {
      process.stdout.write(`BLOCK ${f.file}:${f.line} — ${f.count} comment lines in one logical block (limit ${BLOCK_THRESHOLD - 1}); migrate to docs/ per rules/docs-writing.md § Code Comments\n`);
    }
    for (const f of warnings) {
      process.stdout.write(`WARN  ${f.file}:${f.line} — ${f.count} comment lines in one logical block (warning band ${WARN_THRESHOLD}–${BLOCK_THRESHOLD - 1})\n`);
    }
    if (findings.length === 0) process.stdout.write('OK — no comment block ≥ 25 lines\n');
  }
  return blocking.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { findBlocks, langFor, classify, isExemptBlock, measurable, listFiles, scan, BLOCK_THRESHOLD, WARN_THRESHOLD };
