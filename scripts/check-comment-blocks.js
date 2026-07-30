#!/usr/bin/env node
/**
 * check-comment-blocks.js
 * Enforces rules/docs-writing.md § Code Comments: contiguous comment blocks in
 * .sh/.js sources must stay under 30 lines (25–29 draws a warning). Long
 * rationale belongs in docs/features/<feature>/ with a pointer comment naming
 * the doc section.
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

const BLOCK_THRESHOLD = 30; // ≥30 contiguous comment lines → blocking
const WARN_THRESHOLD = 25; // 25–29 → warning only

const SCAN_DIRS = ['hooks', 'scripts', 'skills'];
const SCAN_EXTS = new Set(['.sh', '.js']);

// Directory-name exemptions (matched at ANY depth): generated or vendored trees.
const EXEMPT_DIR_NAMES = new Set(['node_modules', '.claude', 'dist', 'vendor']);

// Block-content exemptions: a block whose FIRST line matches any of these is
// skipped entirely (license headers, lint/compiler directive stacks).
const EXEMPT_FIRST_LINE = [
  /SPDX-License-Identifier/,
  /Copyright\s+(\(c\)|©|\d{4})/i,
  /eslint-disable/,
  /shellcheck\s+disable/,
];

// A comment line: shell `#` (incl. shebang), JS `//`, or JSDoc-style `*` / `/*`.
const COMMENT_LINE = /^[\s]*(#|\/\/|\/\*|\*)/;

/**
 * Find contiguous comment blocks in file content.
 * Returns [{ line, count }] — 1-based start line + contiguous comment-line count.
 *
 * Stateful across JS block comments: a line starting with an unclosed `/*` puts
 * the scanner in-block, and every physical line until the closing star-slash
 * counts as a comment line even without a `*` prefix — otherwise `/*` + 28 bare
 * rationale lines + close would read as two one-line blocks (fail-open).
 * Only a line-INITIAL `/*` opens the state, so a shell `#` comment or `//` line
 * that merely contains `/*` (e.g. a glob like `path/*`) cannot trap the scanner.
 */
function findBlocks(content) {
  const blocks = [];
  let start = 0;
  let count = 0;
  let inBlock = false;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let isComment;
    if (inBlock) {
      isComment = true;
      if (line.includes('*/')) inBlock = false;
    } else {
      isComment = COMMENT_LINE.test(line);
      if (isComment && /^\s*\/\*/.test(line)) {
        const open = line.indexOf('/*');
        if (line.indexOf('*/', open + 2) === -1) inBlock = true;
      }
    }
    if (isComment) {
      if (count === 0) start = i + 1;
      count++;
    } else {
      if (count > 0) blocks.push({ line: start, count });
      count = 0;
    }
  }
  if (count > 0) blocks.push({ line: start, count });
  return blocks;
}

/** Severity for a block length: 'block' | 'warn' | null. */
function classify(count) {
  if (count >= BLOCK_THRESHOLD) return 'block';
  if (count >= WARN_THRESHOLD) return 'warn';
  return null;
}

/** True if the block is an exempt license/directive header. */
function isExemptBlock(content, block) {
  const first = content.split('\n')[block.line - 1] || '';
  return EXEMPT_FIRST_LINE.some((re) => re.test(first));
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
    for (const block of findBlocks(content)) {
      const severity = classify(block.count);
      if (!severity) continue;
      if (isExemptBlock(content, block)) continue;
      findings.push({ file: rel, line: block.line, count: block.count, severity });
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
      process.stdout.write(`BLOCK ${f.file}:${f.line} — ${f.count} contiguous comment lines (limit ${BLOCK_THRESHOLD - 1}); migrate to docs/ per rules/docs-writing.md § Code Comments\n`);
    }
    for (const f of warnings) {
      process.stdout.write(`WARN  ${f.file}:${f.line} — ${f.count} contiguous comment lines (warning band ${WARN_THRESHOLD}–${BLOCK_THRESHOLD - 1})\n`);
    }
    if (findings.length === 0) process.stdout.write('OK — no comment block ≥ 25 lines\n');
  }
  return blocking.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { findBlocks, classify, isExemptBlock, listFiles, scan, BLOCK_THRESHOLD, WARN_THRESHOLD };
