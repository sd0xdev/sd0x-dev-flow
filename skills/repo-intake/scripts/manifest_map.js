#!/usr/bin/env node
/**
 * manifest_map.js — declared-dependency map over a bounded manifest corpus.
 *
 * Contract: docs/features/repo-intake-manifest-map/2-tech-spec.md (v11).
 * Edges are `declares_dependency` — never import, call, or runtime impact.
 * Fail-closed: unsupported syntax yields partial coverage diagnostics, never
 * guessed edges; an in-corpus candidate blocks externality proof (rust excepted).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Resolve plugin root: validated env var → walk-up with marker → legacy fallback
const _pluginRoot = (() => {
  const sentinel = p => fs.existsSync(path.join(p, 'scripts', 'lib', 'utils.js'));
  const marker = p => fs.existsSync(path.join(p, '.claude-plugin', 'plugin.json'));
  const envRoot = process.env.PLUGIN_ROOT;
  if (envRoot && sentinel(envRoot) && marker(envRoot)) return envRoot;
  let d = __dirname;
  while (d !== path.dirname(d)) {
    if (sentinel(d) && marker(d)) return d;
    d = path.dirname(d);
  }
  return path.resolve(__dirname, '..', '..', '..');
})();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function loadConfigSection() {
  try {
    const p = path.join(_pluginRoot, 'scripts', 'config', 'repo-intake.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { manifestMap: cfg.manifest_map ?? null, classification: null };
  } catch {
    return { manifestMap: null, classification: null };
  }
}

function loadIgnorePrefixes() {
  try {
    const p = path.join(_pluginRoot, 'scripts', 'config', 'file-classification.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).ignore_prefixes ?? [];
  } catch {
    return [
      'node_modules/', 'vendor/', 'dist/', 'build/', 'out/',
      'target/', '.next/', '.nuxt/', '__pycache__/', '.pytest_cache/',
      'venv/', '.venv/', '.git/',
    ];
  }
}

const MM_CONFIG = loadConfigSection().manifestMap ?? {};
const RECOGNIZED = MM_CONFIG.recognized_manifests ?? {
  node: ['package.json'],
  php: ['composer.json'],
  go: ['go.mod'],
  rust: ['Cargo.toml'],
  python: ['pyproject.toml'],
};
const CONTROLLER_MANIFESTS = MM_CONFIG.controller_manifests ?? ['go.work', 'pnpm-workspace.yaml'];
const DETECTION_ONLY = MM_CONFIG.detection_only ?? [
  'pom.xml', '*.csproj', 'build.gradle', 'build.gradle.kts',
  'Gemfile', 'setup.py', 'requirements.txt',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'composer.lock', 'go.sum', 'poetry.lock',
  'BUILD', 'BUILD.bazel', 'WORKSPACE', 'MODULE.bazel', 'CMakeLists.txt',
];
const BUDGETS = {
  maxManifests: MM_CONFIG.budgets?.max_manifests ?? 500,
  maxManifestBytes: MM_CONFIG.budgets?.max_manifest_bytes ?? 1048576,
  topDefault: MM_CONFIG.budgets?.top_default ?? 12,
  sampleLimit: MM_CONFIG.budgets?.sample_limit ?? 12,
};
const FIXTURE_MARKERS = MM_CONFIG.fixture_path_markers ?? ['examples/', 'fixtures/', 'testdata/', 'samples/'];
const IGNORE_PREFIXES = loadIgnorePrefixes();
const IGNORE_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out',
  'target', '.venv', 'venv', '__pycache__', '.pytest_cache',
  '.next', '.turbo', '.cache', '.idea', '.vscode', 'coverage',
  '.coverage', '.mypy_cache',
]);

const RAW_SPEC_LIMIT = 200;

// Deterministic code-unit comparator — locale-independent (byte determinism).
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// basename → ecosystem for recognized package manifests
const BASENAME_TO_ECO = (() => {
  const m = new Map();
  for (const [eco, names] of Object.entries(RECOGNIZED)) {
    for (const n of names) m.set(n, eco);
  }
  return m;
})();

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const USAGE = `Usage: manifest_map.js [--format md|json] [--top N] [--include-candidates]
       manifest_map.js --reverse <selector> [--format md|json] [--include-candidates]
       manifest_map.js --cycles [--format md|json] [--include-candidates]`;

function fail2(msg) {
  process.stderr.write(`${msg}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { format: 'md', top: BUDGETS.topDefault, mode: 'overview', selector: null, includeCandidates: false };
  let topSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format') {
      const v = argv[++i];
      if (v !== 'md' && v !== 'json') fail2(`invalid --format: ${v ?? '(missing)'}`);
      opts.format = v;
    } else if (a === '--top') {
      const v = argv[++i];
      if (v === undefined || !/^[1-9]\d*$/.test(v)) fail2(`invalid --top: ${v ?? '(missing)'}`);
      opts.top = parseInt(v, 10);
      topSet = true;
    } else if (a === '--reverse') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--') || v === '') fail2('--reverse requires a selector');
      if (opts.mode !== 'overview') fail2('--reverse and --cycles are mutually exclusive');
      opts.mode = 'reverse';
      opts.selector = v;
    } else if (a === '--cycles') {
      if (opts.mode !== 'overview') fail2('--reverse and --cycles are mutually exclusive');
      opts.mode = 'cycles';
    } else if (a === '--include-candidates') {
      opts.includeCandidates = true;
    } else {
      fail2(`unknown argument: ${a}`);
    }
  }
  opts.topSet = topSet;
  return opts;
}

// ---------------------------------------------------------------------------
// Corpus enumeration (§3.2)
// ---------------------------------------------------------------------------
function detectRepoRoot(startCwd) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: startCwd, encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return { root: r.stdout.trim(), hasGit: true };
  return { root: startCwd, hasGit: false };
}

function gitListFiles(root) {
  // NUL-separated; paths are NOT trimmed — legal paths may carry leading
  // whitespace or embedded newlines.
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  const out = r.stdout.toString('utf8');
  if (!out) return [];
  return out.split('\0').filter(s => s.length > 0);
}

function walkFiles(root) {
  const out = [];
  function walk(dirRel) {
    const abs = path.join(root, dirRel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        walk(rel);
      } else if (ent.isFile()) {
        out.push(rel);
      }
    }
  }
  walk('');
  return out;
}

function isDetectionOnly(basename) {
  for (const pat of DETECTION_ONLY) {
    if (pat.includes('*')) {
      const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (re.test(basename)) return true;
    } else if (pat === basename) {
      return true;
    }
  }
  return false;
}

function enumerateCorpus(root) {
  const files = gitListFiles(root) ?? walkFiles(root);
  const kept = files.filter(f => !IGNORE_PREFIXES.some(p => f.startsWith(p)));
  const recognized = [];
  const controllers = [];
  const detectionOnly = [];
  for (const f of kept) {
    const base = f.includes('/') ? f.slice(f.lastIndexOf('/') + 1) : f;
    if (BASENAME_TO_ECO.has(base)) recognized.push(f);
    else if (CONTROLLER_MANIFESTS.includes(base)) controllers.push(f);
    else if (isDetectionOnly(base)) detectionOnly.push(f);
  }
  // Deterministic order before any budget cut.
  recognized.sort();
  controllers.sort();
  detectionOnly.sort();
  return { recognized, controllers, detectionOnly };
}

// ---------------------------------------------------------------------------
// Bounded read (§3.2): fstat before content; limit+1 bytes; fatal UTF-8 decode
// ---------------------------------------------------------------------------
function boundedRead(absPath, limitBytes) {
  let fd = null;
  try {
    fd = fs.openSync(absPath, 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { status: 'unreadable' };
    if (st.size > limitBytes) return { status: 'budget_exceeded' };
    const buf = Buffer.alloc(Math.min(st.size, limitBytes + 1));
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, off));
    } catch {
      return { status: 'unreadable' };
    }
    return { status: 'ok', text };
  } catch {
    return { status: 'unreadable' };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---------------------------------------------------------------------------
// Parsers — each returns { ok, data?, unsupported: [{line, construct}] }
// ---------------------------------------------------------------------------

// One pass over the manifest text: (section, key) → first line number. The
// evidence line is a stated heuristic (§3.3, first textual occurrence); the
// index exists so a 50k-dependency manifest is scanned once, not per dep.
function buildJsonLineIndex(text, sectionKeys) {
  const keys = new Set(sectionKeys);
  const idx = new Map();
  const n = text.length;
  let i = 0;
  let line = 1;
  let depth = 0;        // object-brace depth, strings excluded
  let current = null;   // section we are inside, if any
  let sectionDepth = 0; // depth at which `current` was entered
  let lastKey = null;   // most recent string token -- a key iff ':' follows
  while (i < n) {
    const ch = text[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\') {
          // decode JSON escapes so the indexed key equals JSON.parse's key
          const e = text[j + 1];
          if (e === 'u') {
            const cp = parseInt(text.slice(j + 2, j + 6), 16);
            s += Number.isNaN(cp) ? '' : String.fromCharCode(cp);
            j += 6;
          } else {
            const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
            s += map[e] ?? (e ?? '');
            j += 2;
          }
          continue;
        }
        s += text[j]; j++;
      }
      lastKey = { value: s, line };
      i = j + 1;
      continue;
    }
    if (ch === ':') {
      if (lastKey !== null) {
        if (current !== null) {
          const k = `${current}\u0000${lastKey.value}`;
          if (!idx.has(k)) idx.set(k, lastKey.line);
        }
        if (depth === 1 && keys.has(lastKey.value)) {
          // the header itself is addressable as (sec, sec) -- used by the
          // non-object-section unsupported record
          const self = `${lastKey.value}\u0000${lastKey.value}`;
          if (!idx.has(self)) idx.set(self, lastKey.line);
          let j = i + 1;
          while (j < n && /[ \t\r\n]/.test(text[j])) { if (text[j] === '\n') line++; j++; }
          if (text[j] === '{') { current = lastKey.value; sectionDepth = depth; }
          lastKey = null;
          i = j;
          continue;
        }
        lastKey = null;
      }
      i++;
      continue;
    }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') {
      depth--;
      // leaving the section's object ends attribution -- a later top-level
      // section reusing a name must not inherit this one
      if (current !== null && depth <= sectionDepth) current = null;
      i++;
      continue;
    }
    i++;
  }
  return idx;
}

const NODE_DEP_SECTIONS = [
  ['dependencies', 'runtime'],
  ['devDependencies', 'development'],
  ['peerDependencies', 'peer'],
  ['optionalDependencies', 'optional'],
];

function parsePackageJson(text) {
  let obj;
  try {
    obj = JSON.parse(stripBom(text));
  } catch {
    return { ok: false };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return { ok: false };
  const lineIndex = buildJsonLineIndex(text, NODE_DEP_SECTIONS.map(s => s[0]));
  const lineOf = (section, name) => lineIndex.get(`${section}\u0000${name}`) ?? null;
  const deps = [];
  const unsupported = [];
  for (const [section, scope] of NODE_DEP_SECTIONS) {
    const sec = obj[section];
    if (sec === undefined) continue;
    if (typeof sec !== 'object' || sec === null || Array.isArray(sec)) {
      unsupported.push({ line: lineOf(section, section), construct: `${section}: non-object` });
      continue;
    }
    for (const [name, spec] of Object.entries(sec)) {
      const line = lineOf(section, name);
      if (typeof spec !== 'string') {
        unsupported.push({ line, construct: `${section}.${name}: non-string spec` });
        continue;
      }
      deps.push({ name, spec, scope, line });
    }
  }
  let workspaces = null;
  if (obj.workspaces !== undefined) {
    if (Array.isArray(obj.workspaces) && obj.workspaces.every(w => typeof w === 'string')) {
      workspaces = { patterns: obj.workspaces, unsupportedField: false };
    } else {
      workspaces = { patterns: [], unsupportedField: true };
    }
  }
  const name = typeof obj.name === 'string' ? obj.name : null;
  return { ok: true, data: { name, deps, workspaces }, unsupported };
}

function parseComposerJson(text) {
  let obj;
  try {
    obj = JSON.parse(stripBom(text));
  } catch {
    return { ok: false };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return { ok: false };
  const lineIndex = buildJsonLineIndex(text, ['require', 'require-dev']);
  const lineOf = (section, name) => lineIndex.get(`${section}\u0000${name}`) ?? null;
  const deps = [];
  const unsupported = [];
  for (const [section, scope] of [['require', 'runtime'], ['require-dev', 'development']]) {
    const sec = obj[section];
    if (sec === undefined) continue;
    if (typeof sec !== 'object' || sec === null || Array.isArray(sec)) {
      unsupported.push({ line: lineOf(section, section), construct: `${section}: non-object` });
      continue;
    }
    for (const [name, spec] of Object.entries(sec)) {
      const line = lineOf(section, name);
      if (typeof spec !== 'string') {
        unsupported.push({ line, construct: `${section}.${name}: non-string spec` });
        continue;
      }
      deps.push({ name, spec, scope, line });
    }
  }
  const name = typeof obj.name === 'string' ? obj.name : null;
  return { ok: true, data: { name, deps }, unsupported };
}

// --- go.mod / go.work line recognizer ---------------------------------------

function stripGoComment(line) {
  // quote-aware: a // inside a double-quoted string is path data, not a
  // comment opener (`use "./a//b"`). Backslash skips the next char so an
  // escaped quote cannot flip the string state.
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

// conservative Go interpreted-token recognizer shared by module / require /
// replace operands: a bare token (no whitespace, quote forms, backslash, the
// punctuation the Go lexer tokenizes separately) or its double-quoted form
// decoded with NO escape support, both bounded to Unicode printable
// categories. Fail-closed: a quoted token kept verbatim would mint a
// distinct `ext:go:"..."` node instead of the real one (section 3.6)
function parseGoToken(s) {
  let t = null;
  if (s.startsWith('"')) {
    const m = /^"([^"\\\u0000-\u001f\u007f]*)"$/.exec(s);
    if (!m) return null;
    t = m[1];
  } else {
    if (/[\s"'`(){}[\],\\\u0000-\u001f\u007f]/.test(s)) return null;
    t = s;
  }
  if (t === '' || !/^[\p{L}\p{M}\p{N}\p{P}\p{S}]*$/u.test(t)) return null;
  return t;
}

// replace target kinds: 'path' (starts with ./ or ../) vs 'module'
function parseGoReplaceClause(clause) {
  // clause: "old [v] => new [v]"
  const m = clause.split('=>');
  if (m.length !== 2) return null;
  const left = m[0].trim().split(/\s+/).filter(Boolean);
  const right = m[1].trim().split(/\s+/).filter(Boolean);
  if (left.length < 1 || left.length > 2 || right.length < 1 || right.length > 2) return null;
  const toks = [...left, ...right].map(parseGoToken);
  if (toks.some(tok => tok === null)) return null;
  const target = toks[left.length];
  const isPath = target.startsWith('./') || target.startsWith('../');
  return {
    oldModule: toks[0],
    oldVersion: left.length === 2 ? toks[1] : null,
    targetKind: isPath ? 'path' : 'module',
    targetPath: isPath ? target : null,
  };
}

function parseGoFile(text, kind /* 'go.mod' | 'go.work' */) {
  const lines = stripBom(text).split(/\r?\n/);
  const out = { module: null, requires: [], replaces: [], uses: [], unsupported: [], membershipUnsupported: [] };
  // membership failure domain (§3.3): a use-related parse failure means the
  // go.work member set may be incomplete — the controller reads this subset so
  // it never marks partial off unrelated failures (require/replace/foreign)
  const pushUseUnsupported = (lineNo, construct) => {
    const entry = { line: lineNo, construct };
    out.unsupported.push(entry);
    out.membershipUnsupported.push(entry);
  };
  // frozen use-operand subset: a balanced double-quoted string containing no
  // backslash escapes, or one token free of whitespace and quote/paren
  // punctuation. Everything else — unclosed/single/backtick quoting, embedded
  // quotes, parens, escape sequences valid OR invalid — must never yield a
  // path: malformed syntax cannot confirm members (§6), and escape decoding is
  // not implemented, so escape-bearing operands fail closed rather than being
  // taken literally and matching the wrong directory
  const parseUseOperand = (s) => {
    let p = null;
    if (s.startsWith('"')) {
      const m = /^"([^"\\\u0000-\u001f\u007f]*)"$/.exec(s);
      if (!m) return { ok: false };
      p = m[1];
    } else {
      // rejection set mirrors Go's modfile lexer: whitespace, every quote
      // form, the punctuation it tokenizes separately ((){}[],), backslash
      // (Windows separators are outside the frozen v1 subset), control
      // characters, and the /* sequence (Go rejects block comments outright
      // — an unquoted ./modules/* is malformed Go, not a literal path)
      if (/[\s"'`(){}[\],\\\u0000-\u001f\u007f]/.test(s) || s.includes('/*')) return { ok: false };
      p = s;
    }
    // frozen v1 subset: NON-EMPTY. Go itself resolves `use ""` to the
    // controller directory, but the empty operand is outside the frozen
    // subset — its meaning would be decided by path.join coincidence, so
    // it fails closed instead of silently aliasing `use .`
    if (p === '') return { ok: false };
    // Go modfile lexer boundary: a token rune must satisfy !unicode.IsSpace
    // && unicode.IsPrint. JS \s misses U+0085, and the C0/DEL ranges above
    // miss Cf/Zs forms (U+200B, U+2060, NBSP), so membership is stated
    // positively: only Unicode printable categories (L/M/N/P/S) plus the
    // ASCII space that quoting exists to carry — both operand forms
    if (!/^[\p{L}\p{M}\p{N}\p{P}\p{S} ]*$/u.test(p)) return { ok: false };
    // frozen v1 subset: RELATIVE paths only. An absolute or drive-qualified
    // operand is legal Go but is NOT controller-relative — interpreting it
    // as one would confirm the wrong directory, so it fails closed instead
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return { ok: false };
    return { ok: true, path: p };
  };
  let block = null; // 'require' | 'replace' | 'use' | 'ignore' | null
  let blockOpen = null; // { label, line, snap } — for EOF rollback
  const openBlock = (name, label, lineNo) => {
    block = name;
    blockOpen = {
      label, line: lineNo,
      snap: { r: out.requires.length, p: out.replaces.length, u: out.uses.length },
    };
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = stripGoComment(lines[i]).trim();
    if (!raw) continue;
    const lineNo = i + 1;
    if (block) {
      if (raw === ')') { block = null; blockOpen = null; continue; }
      if (block === 'require') {
        const parts = raw.split(/\s+/).filter(Boolean);
        const emod = parts.length === 2 ? parseGoToken(parts[0]) : null;
        const ever = parts.length === 2 ? parseGoToken(parts[1]) : null;
        if (emod !== null && ever !== null) out.requires.push({ module: emod, version: ever, line: lineNo });
        else out.unsupported.push({ line: lineNo, construct: `require entry: ${raw.slice(0, 80)}` });
      } else if (block === 'replace') {
        const rep = parseGoReplaceClause(raw);
        if (rep) out.replaces.push({ ...rep, line: lineNo });
        else out.unsupported.push({ line: lineNo, construct: `replace entry: ${raw.slice(0, 80)}` });
      } else if (block === 'use') {
        const op = parseUseOperand(raw);
        if (op.ok) out.uses.push({ path: op.path, line: lineNo });
        else pushUseUnsupported(lineNo, `use entry: ${raw.slice(0, 80)}`);
      }
      // 'ignore' (exclude/retract) entries carry no map meaning — consumed only
      continue;
    }
    // §3.5 parser matrix: go.mod extracts module/require/replace (exclude and
    // retract are legal go.mod syntax, consumed with no map meaning); go.work
    // extracts use/replace. A directive from the OTHER kind is unsupported.
    const isMod = kind === 'go.mod';
    if (raw.startsWith('module ')) {
      if (isMod) {
        const mtok = parseGoToken(raw.slice('module '.length).trim());
        if (mtok !== null) out.module = mtok;
        else out.unsupported.push({ line: lineNo, construct: `module: ${raw.slice(0, 80)}` });
      }
      else out.unsupported.push({ line: lineNo, construct: `${kind} directive: ${raw.slice(0, 80)}` });
    } else if (raw === 'require (') {
      if (isMod) openBlock('require', 'require', lineNo);
      else {
        out.unsupported.push({ line: lineNo, construct: `${kind} directive: require block` });
        openBlock('ignore', 'require', lineNo);
      }
    } else if (raw === 'replace (') {
      openBlock('replace', 'replace', lineNo);
    } else if (raw === 'use (') {
      if (!isMod) openBlock('use', 'use', lineNo);
      else {
        out.unsupported.push({ line: lineNo, construct: `${kind} directive: use block` });
        openBlock('ignore', 'use', lineNo);
      }
    } else if (raw === 'exclude (' || raw === 'retract (') {
      const label = raw.split(' ')[0];
      if (!isMod) out.unsupported.push({ line: lineNo, construct: `${kind} directive: ${label} block` });
      openBlock('ignore', label, lineNo);
    } else if (raw.startsWith('require ')) {
      if (isMod) {
        const parts = raw.slice('require '.length).trim().split(/\s+/).filter(Boolean);
        const smod = parts.length === 2 ? parseGoToken(parts[0]) : null;
        const sver = parts.length === 2 ? parseGoToken(parts[1]) : null;
        if (smod !== null && sver !== null) out.requires.push({ module: smod, version: sver, line: lineNo });
        else out.unsupported.push({ line: lineNo, construct: `require: ${raw.slice(0, 80)}` });
      } else {
        out.unsupported.push({ line: lineNo, construct: `${kind} directive: ${raw.slice(0, 80)}` });
      }
    } else if (raw.startsWith('replace ')) {
      const rep = parseGoReplaceClause(raw.slice('replace '.length));
      if (rep) out.replaces.push({ ...rep, line: lineNo });
      else out.unsupported.push({ line: lineNo, construct: `replace: ${raw.slice(0, 80)}` });
    } else if (raw.startsWith('use ')) {
      if (!isMod) {
        const op = parseUseOperand(raw.slice('use '.length).trim());
        if (op.ok) out.uses.push({ path: op.path, line: lineNo });
        else pushUseUnsupported(lineNo, `use: ${raw.slice('use '.length).trim().slice(0, 80)}`);
      } else out.unsupported.push({ line: lineNo, construct: `${kind} directive: ${raw.slice(0, 80)}` });
    } else if (raw === 'use') {
      if (!isMod) pushUseUnsupported(lineNo, 'use directive: missing operand');
      else out.unsupported.push({ line: lineNo, construct: `${kind} directive: use` });
    } else if (/^(go|toolchain)\b/.test(raw)) {
      // recognized non-map directives — ignored in both kinds
    } else if (/^(exclude|retract)\b/.test(raw)) {
      if (!isMod) out.unsupported.push({ line: lineNo, construct: `${kind} directive: ${raw.slice(0, 80)}` });
      // go.mod: legal, no map meaning — ignored
    } else {
      out.unsupported.push({ line: lineNo, construct: `${kind} directive: ${raw.slice(0, 80)}` });
    }
  }
  if (block !== null) {
    // Unterminated block at EOF: entries after the opener are not a complete
    // record — roll them back and fail closed on the whole block.
    out.requires.length = blockOpen.snap.r;
    out.replaces.length = blockOpen.snap.p;
    out.uses.length = blockOpen.snap.u;
    const entry = { line: blockOpen.line, construct: `unterminated ${blockOpen.label} block` };
    out.unsupported.push(entry);
    // only a go.work use block is a MEMBERSHIP failure; go.mod's foreign 'use'
    // and require/replace blocks fail closed without touching member semantics
    if (kind === 'go.work' && blockOpen.label === 'use') out.membershipUnsupported.push(entry);
  }
  return { ok: true, data: out, unsupported: out.unsupported };
}

// --- Conservative TOML field recognizer (Cargo + PEP 621) --------------------
// Frozen governance boundary (§3.5): only the named fields below are
// interpreted; anything else inside a dependency-related section is an
// unsupported construct (partial, no edge). Unrelated sections are ignored.

function parseTomlString(v) {
  const m = v.match(/^"((?:[^"\\]|\\.)*)"$/) || v.match(/^'([^']*)'$/);
  if (!m) return null;
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

// Parses a single-line inline table: { k = v, ... } with string/bool values only.
function parseInlineTable(src) {
  const inner = src.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
  if (inner === '') return {};
  const out = {};
  // split on commas not inside quotes
  const parts = [];
  let cur = '';
  let q = null;
  for (const ch of inner) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      cur += ch;
      q = ch;
    } else if (ch === ',') {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) return null;
    const k = part.slice(0, eq).trim();
    const vRaw = part.slice(eq + 1).trim();
    if (vRaw === 'true' || vRaw === 'false') {
      out[k] = vRaw === 'true';
    } else {
      const s = parseTomlString(vRaw);
      if (s === null) return null;
      out[k] = s;
    }
  }
  return out;
}

// First ']' outside single/double quotes, or -1 — quote-aware, so a ']' inside
// a version string like "foo[extra]>=1" is data, not a terminator.
function findUnquotedClose(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (q === '"' && ch === '\\') { i++; continue; } // basic-string escape
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === ']') return i;
  }
  return -1;
}

// Quote-aware comma split of array-body content, keeping each segment's offset
// so multi-line entries attribute to their own physical line.
function splitTomlArrayItems(content) {
  const segs = [];
  let q = null;
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (q) {
      if (q === '"' && ch === '\\') { i++; continue; } // basic-string escape
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === ',') { segs.push({ raw: content.slice(start, i), offset: start }); start = i + 1; }
  }
  segs.push({ raw: content.slice(start), offset: start });
  return segs;
}

// content: the inside of a string array (brackets stripped), possibly spanning
// physical lines joined by '\n'. Returns [{value, line}] with per-item lines.
function parseTomlStringArray(content, startLine, fieldName, out) {
  const entries = [];
  for (const seg of splitTomlArrayItems(content)) {
    const t = seg.raw.trim();
    if (t === '') continue;
    const lead = seg.raw.length - seg.raw.trimStart().length;
    const nl = (content.slice(0, seg.offset + lead).match(/\n/g) || []).length;
    const line = startLine + nl;
    const s = parseTomlString(t);
    if (s === null) out.unsupported.push({ line, construct: `${fieldName}: non-string array entry` });
    else entries.push({ value: s, line });
  }
  return entries;
}

// Entry point for a `key = [...]` value: single-line arrays commit immediately,
// multi-line ones open a buffered arrayField via beginArray.
function consumeTomlArray(out, fieldName, val, lineNo, beginArray, commit) {
  if (!val.startsWith('[')) {
    out.unsupported.push({ line: lineNo, construct: `${fieldName}: non-array value` });
    return;
  }
  const inner = val.slice(1);
  const close = findUnquotedClose(inner);
  if (close === -1) {
    beginArray(fieldName, inner, commit);
    return;
  }
  if (inner.slice(close + 1).trim() !== '') {
    // trailing junk after ']' — malformed line, no evidence committed
    out.unsupported.push({ line: lineNo, construct: `${fieldName}: trailing content after array` });
    return;
  }
  commit(parseTomlStringArray(inner.slice(0, close), lineNo, fieldName, out));
}

const CARGO_DEP_SECTIONS = {
  dependencies: { scope: 'runtime', condition: null },
  'dev-dependencies': { scope: 'development', condition: null },
  'build-dependencies': { scope: 'build', condition: null },
};
const CARGO_INLINE_FIELDS = new Set(['version', 'path', 'package', 'workspace', 'optional']);

// quote-aware TOML header scanner: for a line starting with '[', finds the
// FIRST closing-bracket run that sits outside quoted strings (single-quoted
// TOML strings are literal; double-quoted ones honour backslash escapes —
// same convention as the comment stripper below). Returns the leading and
// closing bracket-run lengths, the payload between them, and any trailing
// rest; close: 0 means the header never closes outside a string
function scanTomlHeader(line) {
  let open = 0;
  while (line[open] === '[') open++;
  let q = null;
  for (let i = open; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === ']') {
      let close = 0;
      while (line[i + close] === ']') close++;
      return { open, close, name: line.slice(open, i).trim(), rest: line.slice(i + close).trim() };
    }
  }
  return { open, close: 0, name: line.slice(open).trim(), rest: '' };
}

function parseTomlManifest(text, flavor /* 'cargo' | 'pyproject' */) {
  const lines = stripBom(text).split(/\r?\n/);
  const out = {
    packageName: null,
    hasPackage: false,
    hasWorkspace: false,
    hasProject: false,
    members: [],
    exclude: [],
    templates: [],   // workspace.dependencies entries
    deps: [],        // {name, form, spec|fields, scope, condition, line}
    pyDeps: [],      // {raw, scope, line}
    unsupported: [],
  };
  let section = null;
  let arrayField = null; // { name, buffer, startLine, commit }
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    let line = rawLine;
    // strip comments outside strings — escape-aware scan for the first
    // unquoted '#' (quote-parity counting misreads escaped quotes)
    {
      let q = null;
      for (let ci = 0; ci < line.length; ci++) {
        const c = line[ci];
        if (q) {
          if (q === '"' && c === '\\') { ci++; continue; }
          if (c === q) q = null;
        } else if (c === '"' || c === "'") q = c;
        else if (c === '#') { line = line.slice(0, ci); break; }
      }
    }
    line = line.trim();

    if (arrayField) {
      // append even empty lines so per-item line attribution stays physical
      arrayField.buffer += '\n' + line;
      const close = findUnquotedClose(arrayField.buffer);
      if (close !== -1) {
        if (arrayField.buffer.slice(close + 1).trim() !== '') {
          out.unsupported.push({ line: lineNo, construct: `${arrayField.name}: trailing content after array` });
        } else {
          arrayField.commit(parseTomlStringArray(
            arrayField.buffer.slice(0, close), arrayField.startLine, arrayField.name, out));
        }
        arrayField = null;
      }
      continue;
    }
    if (!line) continue;

    if (line.startsWith('[')) {
      const h = scanTomlHeader(line);
      if (h.open === 1 && h.close === 1 && h.rest === '' && h.name !== '') {
        section = h.name;
        if (flavor === 'cargo') {
          if (section === 'package') out.hasPackage = true;
          if (section === 'workspace') out.hasWorkspace = true;
        } else if (section === 'project') {
          out.hasProject = true;
        }
        continue;
      }
      // array-of-tables ([[name]]), mismatched brackets, trailing junk and
      // unclosed headers are outside the frozen recognizer: never the single
      // table they resemble, and never a place evidence is committed from.
      // The OLD section must not keep absorbing keys either — evidence
      // recorded under a stale header is forged — so the section always
      // resets. Relevant contexts (the stale section, or the quote-aware
      // first-payload name this line tried to open — trailing junk must not
      // hide it) leave an unsupported record; unrelated ones stay inert (§3.5)
      const bare = bareEvidenceSections(flavor);
      if (isDependencyRelatedSection(section, flavor) || bare.includes(section)
        || isDependencyRelatedSection(h.name, flavor) || bare.includes(h.name)) {
        out.unsupported.push({ line: lineNo, construct: `unsupported table form: ${line.slice(0, 80)}` });
      }
      section = '!unsupported-table';
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      if (isDependencyRelatedSection(section, flavor)) {
        out.unsupported.push({ line: lineNo, construct: `${section}: unparseable line` });
      }
      continue;
    }
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();

    const beginArray = (name, buffer, commit) => {
      arrayField = { name, buffer, startLine: lineNo, commit };
    };
    if (flavor === 'cargo') {
      handleCargoKV(out, section, key, val, lineNo, beginArray);
    } else {
      handlePyprojectKV(out, section, key, val, lineNo, beginArray);
    }
  }
  if (arrayField) {
    out.unsupported.push({ line: arrayField.startLine, construct: `${arrayField.name}: unterminated array` });
  }
  return { ok: true, data: out, unsupported: out.unsupported };
}

// the non-dependency sections evidence is committed from, per flavor — used
// to scope malformed-header coverage marking so a truly unrelated table in
// the OTHER flavor's namespace never marks this manifest partial
function bareEvidenceSections(flavor) {
  return flavor === 'cargo' ? ['package', 'workspace'] : ['project'];
}

function isDependencyRelatedSection(section, flavor) {
  if (!section) return false;
  if (flavor === 'cargo') {
    return section === 'workspace' || section === 'workspace.dependencies'
      || CARGO_DEP_SECTIONS[section] !== undefined
      || /^target\.'cfg\([^']*\)'\.(dependencies|dev-dependencies|build-dependencies)$/.test(section);
  }
  return section === 'project' || section === 'project.optional-dependencies';
}

function handleCargoKV(out, section, key, val, lineNo, beginArray) {
  if (section === 'package') {
    if (key === 'name') {
      const s = parseTomlString(val);
      if (s !== null) out.packageName = s;
    }
    return;
  }
  if (section === 'workspace') {
    if (key === 'members' || key === 'exclude') {
      consumeTomlArray(out, `workspace.${key}`, val, lineNo, beginArray, entries => {
        if (key === 'members') out.members = entries;
        else out.exclude = entries;
      });
      return;
    }
    out.unsupported.push({ line: lineNo, construct: `workspace.${key}: unrecognized field` });
    return;
  }
  if (section === 'workspace.dependencies') {
    const entry = parseCargoDepEntry(key, val, lineNo, out);
    if (entry) out.templates.push(entry);
    return;
  }
  const plain = CARGO_DEP_SECTIONS[section];
  const cfgM = section ? section.match(/^target\.'(cfg\([^']*\))'\.(dependencies|dev-dependencies|build-dependencies)$/) : null;
  if (plain || cfgM) {
    if (cfgM && cfgM[2] !== 'dependencies') {
      out.unsupported.push({ line: lineNo, construct: `${section}: unsupported target section` });
      return;
    }
    const scope = plain ? plain.scope : 'runtime';
    const condition = cfgM ? cfgM[1] : null;
    const entry = parseCargoDepEntry(key, val, lineNo, out);
    if (entry) out.deps.push({ ...entry, scope, condition });
    return;
  }
  // unrelated section — ignore entirely (governance boundary)
}

function parseCargoDepEntry(key, val, lineNo, out) {
  if (key.includes('.')) {
    out.unsupported.push({ line: lineNo, construct: `dependency dotted key: ${key}` });
    return null;
  }
  if (val.startsWith('{')) {
    if (!val.endsWith('}')) {
      // multi-line/unterminated inline table — fail closed, no field guessing
      out.unsupported.push({ line: lineNo, construct: `dependency inline table unterminated: ${key}` });
      return null;
    }
    const table = parseInlineTable(val);
    if (table === null) {
      out.unsupported.push({ line: lineNo, construct: `dependency inline table unparseable: ${key}` });
      return null;
    }
    for (const [f, v] of Object.entries(table)) {
      if (!CARGO_INLINE_FIELDS.has(f)) {
        out.unsupported.push({ line: lineNo, construct: `dependency field '${f}' on ${key}` });
        return null;
      }
      const wantBool = f === 'workspace' || f === 'optional';
      if (wantBool ? typeof v !== 'boolean' : typeof v !== 'string') {
        out.unsupported.push({ line: lineNo, construct: `dependency field '${f}' has non-${wantBool ? 'boolean' : 'string'} value on ${key}` });
        return null;
      }
    }
    return { name: key, form: 'table', fields: table, rawSpec: val, line: lineNo };
  }
  const s = parseTomlString(val);
  if (s === null) {
    out.unsupported.push({ line: lineNo, construct: `dependency value unparseable: ${key}` });
    return null;
  }
  return { name: key, form: 'version', spec: s, rawSpec: val, line: lineNo };
}

function handlePyprojectKV(out, section, key, val, lineNo, beginArray) {
  if (section === 'project') {
    if (key === 'name') {
      const s = parseTomlString(val);
      if (s !== null) out.packageName = s;
      return;
    }
    if (key === 'dependencies') {
      consumePyArray(out, 'project.dependencies', val, lineNo, beginArray, 'runtime');
      return;
    }
    return; // other [project] fields: unrelated
  }
  if (section === 'project.optional-dependencies') {
    consumePyArray(out, `project.optional-dependencies.${key}`, val, lineNo, beginArray, 'optional');
  }
  // all other sections ([tool.*], [build-system]) — ignored
}

function consumePyArray(out, fieldName, val, lineNo, beginArray, scope) {
  consumeTomlArray(out, fieldName, val, lineNo, beginArray, entries => {
    for (const it of entries) out.pyDeps.push({ raw: it.value, scope, line: it.line });
  });
}

// ---------------------------------------------------------------------------
// node version-spec lexical classification (§3.6, frozen EBNF)
// ---------------------------------------------------------------------------
const VERSION_TOKEN_RE = (() => {
  const part = '(?:\\d+|x|X|\\*)';
  const ident = '[A-Za-z0-9-]+';
  const idents = `${ident}(?:\\.${ident})*`;
  const version = `v?${part}(?:\\.${part}(?:\\.${part})?)?(?:-${idents})?(?:\\+${idents})?`;
  return {
    bare: new RegExp(`^${version}$`),
    withComparator: new RegExp(`^(\\^|~|>=|<=|>|<|=)?${version}$`),
  };
})();

function versionPostValidations(tok) {
  // strip comparator
  const m = tok.match(/^(\^|~|>=|<=|>|<|=)?(.*)$/);
  const v = m[2];
  const core = v.replace(/^v/, '').replace(/[-+].*$/, '');
  const parts = core.split('.');
  const isWild = p => p === 'x' || p === 'X' || p === '*';
  // (a) wildcard only in trailing consecutive positions
  let seenWild = false;
  for (const p of parts) {
    if (isWild(p)) seenWild = true;
    else if (seenWild) return false;
  }
  // (b) -/+ suffix only on three all-digit parts
  if (/[-+]/.test(v.replace(/^v/, ''))) {
    if (parts.length !== 3 || parts.some(isWild)) return false;
  }
  return true;
}

function matchesRangeGrammar(spec) {
  if (spec !== spec.trim()) return false;
  if (/[\r\n]/.test(spec)) return false;
  const segments = spec.split(/[ \t]*\|\|[ \t]*/);
  for (const seg of segments) {
    if (seg === '') return false;
    const tokens = seg.split(/[ \t]+/);
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (tokens[i + 1] === '-') {
        // hyphen range: both ends bare versions, exactly two ends
        const a = t;
        const b = tokens[i + 2];
        if (b === undefined) return false;
        if (!VERSION_TOKEN_RE.bare.test(a) || !VERSION_TOKEN_RE.bare.test(b)) return false;
        if (!versionPostValidations(a) || !versionPostValidations(b)) return false;
        i += 3;
      } else if (t === '-') {
        return false;
      } else if (VERSION_TOKEN_RE.withComparator.test(t)) {
        if (!versionPostValidations(t)) return false;
        i += 1;
      } else {
        return false;
      }
    }
  }
  return true;
}

const DIST_TAG_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;

function classifyNodeSpec(spec) {
  if (spec.startsWith('file:') || spec.startsWith('link:')) {
    return { kind: 'path', path: spec.slice(spec.indexOf(':') + 1) };
  }
  if (spec.startsWith('workspace:')) return { kind: 'workspace-intent' };
  if (spec === '*') return { kind: 'registry', sub: 'star' };
  if (matchesRangeGrammar(spec)) return { kind: 'registry', sub: 'range' };
  if (DIST_TAG_RE.test(spec)) return { kind: 'registry', sub: 'dist-tag' };
  return { kind: 'unsupported' };
}

// ---------------------------------------------------------------------------
// PEP 503 / PEP 508 leading-name extraction (conservative)
// ---------------------------------------------------------------------------
function pep503Normalize(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function extractPyDepName(raw) {
  const m = raw.match(/^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(.*)$/);
  if (!m) return { ok: false };
  const rest = m[2];
  // URL/editable/direct references are unsupported (fail-closed)
  if (rest.includes('@')) return { ok: false };
  // environment markers (';' clause) → unsupported: spec §3.5 keeps only the
  // provable leading name, and a marker makes applicability unprovable
  if (rest.includes(';')) return { ok: false };
  if (rest !== '' && !/^[\[(<>=!~]/.test(rest)) return { ok: false };
  return { ok: true, name: pep503Normalize(m[1]) };
}

module.exports = {
  // exported for focused unit tests
  matchesRangeGrammar,
  classifyNodeSpec,
  extractPyDepName,
  parseGoFile,
  parseTomlManifest,
  parsePackageJson,
  parseComposerJson,
  parseInlineTable,
  boundedRead,
  enumerateCorpus,
  findCycles,
};

// ---------------------------------------------------------------------------
// Graph assembly (§3.4, §3.6)
// ---------------------------------------------------------------------------

function buildMap(root, opts) {
  const { recognized, controllers: controllerFiles, detectionOnly } = enumerateCorpus(root);
  const coverage = new Map(); // manifest → {status, reason, unsupported[]}
  const omissions = [];
  const diagnostics = [];

  // One budget over the WHOLE manifest population (recognized + controllers +
  // detection-only), applied on the path-sorted union (§3.2).
  const parseKind = new Set([...recognized, ...controllerFiles]);
  const allManifests = [...recognized, ...controllerFiles, ...detectionOnly].sort();
  let keptManifests = allManifests;
  if (allManifests.length > BUDGETS.maxManifests) {
    keptManifests = allManifests.slice(0, BUDGETS.maxManifests);
    const dropped = allManifests.slice(BUDGETS.maxManifests);
    omissions.push({
      reason: 'manifest_budget',
      count: dropped.length,
      sample: dropped.slice(0, BUDGETS.sampleLimit),
    });
  }
  const parseTargets = keptManifests.filter(f => parseKind.has(f));
  const budgetedSet = new Set(parseTargets);
  const skippedBudgetTargets = new Set([...parseKind].filter(f => !budgetedSet.has(f)));
  for (const f of keptManifests) {
    if (!parseKind.has(f)) {
      coverage.set(f, { status: 'unrecognized', reason: null, unsupported: [] });
    }
  }

  const realRoot = (() => {
    try { return fs.realpathSync(root); } catch { return root; }
  })();

  const parsed = new Map(); // manifest path → {eco|'go.work'|'pnpm', parse result}
  const unreadableTargets = new Set();
  for (const rel of parseTargets) {
    const base = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
    if (base === 'pnpm-workspace.yaml') {
      coverage.set(rel, { status: 'unrecognized', reason: null, unsupported: [] });
      parsed.set(rel, { kind: 'pnpm' });
      continue;
    }
    // realpath fence BEFORE any read: a symlinked manifest that escapes the
    // corpus is never opened — same containment rule as path-form targets.
    let realAbs;
    try {
      realAbs = fs.realpathSync(path.join(root, rel));
    } catch {
      coverage.set(rel, { status: 'skipped', reason: 'unreadable', unsupported: [] });
      unreadableTargets.add(rel);
      continue;
    }
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
      // coverage reason stays inside the §3.3 union ('unreadable' — the content
      // is never read); the containment cause is preserved as a diagnostic
      coverage.set(rel, { status: 'skipped', reason: 'unreadable', unsupported: [] });
      diagnostics.push({ code: 'manifest_outside_corpus', manifest: rel });
      unreadableTargets.add(rel);
      continue;
    }
    const read = boundedRead(realAbs, BUDGETS.maxManifestBytes);
    if (read.status === 'budget_exceeded') {
      coverage.set(rel, { status: 'skipped', reason: 'budget_exceeded', unsupported: [] });
      skippedBudgetTargets.add(rel);
      continue;
    }
    if (read.status !== 'ok') {
      coverage.set(rel, { status: 'skipped', reason: 'unreadable', unsupported: [] });
      unreadableTargets.add(rel);
      continue;
    }
    let result = null;
    let kind = null;
    if (base === 'package.json') { result = parsePackageJson(read.text); kind = 'node'; }
    else if (base === 'composer.json') { result = parseComposerJson(read.text); kind = 'php'; }
    else if (base === 'go.mod') { result = parseGoFile(read.text, 'go.mod'); kind = 'go'; }
    else if (base === 'go.work') { result = parseGoFile(read.text, 'go.work'); kind = 'go.work'; }
    else if (base === 'Cargo.toml') { result = parseTomlManifest(read.text, 'cargo'); kind = 'rust'; }
    else if (base === 'pyproject.toml') { result = parseTomlManifest(read.text, 'pyproject'); kind = 'python'; }
    if (!result || !result.ok) {
      coverage.set(rel, { status: 'skipped', reason: 'unreadable', unsupported: [] });
      unreadableTargets.add(rel);
      continue;
    }
    coverage.set(rel, {
      status: result.unsupported.length > 0 ? 'partial' : 'parsed',
      reason: result.unsupported.length > 0 ? 'manifest_parse_incomplete' : null,
      unsupported: result.unsupported,
    });
    parsed.set(rel, { kind, data: result.data, text: read.text });
  }

  const markPartial = (rel, line, construct) => {
    const cov = coverage.get(rel);
    if (!cov) return;
    if (cov.status === 'parsed') { cov.status = 'partial'; cov.reason = 'manifest_parse_incomplete'; }
    cov.unsupported.push({ line, construct });
  };

  // --- nodes ---------------------------------------------------------------
  const dirOf = rel => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.');
  const nodes = new Map(); // id → node
  const nodeByManifest = new Map();
  for (const [rel, p] of parsed) {
    let eco = null;
    let name = null;
    if (p.kind === 'node') { eco = 'node'; name = p.data.name; }
    else if (p.kind === 'php') { eco = 'php'; name = p.data.name; }
    else if (p.kind === 'go') { eco = 'go'; name = p.data.module; }
    else if (p.kind === 'rust') {
      if (!p.data.hasPackage) continue; // virtual workspace root: controller only
      eco = 'rust'; name = p.data.packageName;
    } else if (p.kind === 'python') {
      if (!p.data.hasProject) continue; // tool-only pyproject: no package identity
      eco = 'python'; name = p.data.packageName;
    } else {
      continue;
    }
    const dir = dirOf(rel);
    const id = `ws:${eco}:${dir}`;
    const flags = [];
    if (FIXTURE_MARKERS.some(mk => rel.includes(mk))) flags.push('likely_fixture');
    const node = {
      id, name: name ?? null, nameSource: name ? 'manifest' : null,
      ecosystem: eco, manifest: rel, role: 'candidate_workspace', flags,
    };
    nodes.set(id, node);
    nodeByManifest.set(rel, node);
  }

  // --- controllers (§3.4) --------------------------------------------------
  const controllers = [];
  const confirmations = new Map(); // node id → Set(controller ids)
  const patternSupported = pat => {
    if (pat === '') return false;
    const segs = pat.split('/');
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.includes('*')) {
        if (!(i === segs.length - 1 && s === '*')) return false;
      }
      if (s === '' || s === '.' || s === '..') return false;
    }
    return true;
  };
  const matchMembers = (ctlDir, pat, eco) => {
    // returns node ids of same-ecosystem package manifests matched by pattern
    const ids = [];
    const prefix = ctlDir === '.' ? '' : `${ctlDir}/`;
    for (const node of nodes.values()) {
      if (node.ecosystem !== eco) continue;
      const nd = node.id.slice(`ws:${eco}:`.length);
      const relDir = nd === '.' ? '' : nd;
      if (ctlDir !== '.' && !(relDir === ctlDir || relDir.startsWith(prefix))) continue;
      const local = ctlDir === '.' ? relDir : relDir.slice(prefix.length);
      if (local === '') continue; // controller's own dir
      if (pat.endsWith('/*')) {
        const base = pat.slice(0, -2);
        if (local.startsWith(`${base}/`) && !local.slice(base.length + 1).includes('/')) ids.push(node.id);
      } else if (pat === '*') {
        if (!local.includes('/')) ids.push(node.id);
      } else if (local === pat) {
        ids.push(node.id);
      }
    }
    return ids;
  };

  function addController(type, rel, includePatterns, excludePatterns, memberEco, presetStatus) {
    const dir = dirOf(rel);
    const id = `ctl:${type}:${dir}`;
    const diags = [];
    let status = presetStatus ?? 'parsed';
    let members = [];
    if (status !== 'unknown') {
      let anyUnsupportedInclude = false;
      let unsupportedExclude = false;
      for (const ex of excludePatterns) {
        if (!patternSupported(ex.value)) {
          diags.push({ construct: 'unsupported exclude pattern', value: ex.value });
          unsupportedExclude = true;
        }
      }
      if (unsupportedExclude) {
        // exclusion scope unknowable → this controller confirms nothing
        // (controller-local: another eligible controller may still confirm)
        status = 'unknown';
        members = null;
      } else {
        const excluded = new Set();
        for (const ex of excludePatterns) {
          for (const nid of matchMembers(dir, ex.value, memberEco)) excluded.add(nid);
        }
        const confirmedIds = new Set();
        for (const inc of includePatterns) {
          if (!patternSupported(inc.value)) {
            diags.push({ construct: 'unsupported member pattern', value: inc.value });
            anyUnsupportedInclude = true;
            continue;
          }
          const matched = matchMembers(dir, inc.value, memberEco);
          if (matched.length === 0) {
            // supported pattern, zero members — surfaced, but not a partial:
            // matching nothing is a provable (empty) result, not a parse gap
            diags.push({ construct: 'unmatched member pattern', value: inc.value });
          }
          for (const nid of matched) {
            if (!excluded.has(nid)) confirmedIds.add(nid);
          }
        }
        if (anyUnsupportedInclude) status = 'partial';
        members = [...confirmedIds].sort();
        for (const nid of confirmedIds) {
          if (!confirmations.has(nid)) confirmations.set(nid, new Set());
          confirmations.get(nid).add(id);
        }
      }
    } else {
      members = null;
    }
    const record = { id, controllerType: type, manifest: rel, membershipStatus: status, diagnostics: diags };
    if (members !== null) record.members = members;
    controllers.push(record);
    return record;
  }

  for (const [rel, p] of parsed) {
    if (p.kind === 'pnpm') {
      addController('pnpm_workspace', rel, [], [], 'node', 'unknown');
    } else if (p.kind === 'node' && p.data.workspaces) {
      if (p.data.workspaces.unsupportedField) {
        const rec = addController('node_workspaces', rel, [], [], 'node', 'partial');
        rec.diagnostics.push({ construct: 'unsupported member pattern', value: 'workspaces: non-string-array form' });
        rec.members = [];
      } else {
        addController('node_workspaces', rel,
          p.data.workspaces.patterns.map(v => ({ value: v })), [], 'node');
      }
    } else if (p.kind === 'rust' && p.data.hasWorkspace) {
      addController('cargo_workspace', rel, p.data.members, p.data.exclude, 'rust');
    } else if (p.kind === 'go.work') {
      // §3.4: go.work use is a LITERAL path — never the node/cargo glob subset,
      // so this branch does not go through patternSupported/matchMembers (which
      // would expand a trailing *). Resolution is normalizeRel + exact go.mod
      // lookup — the SAME derivation goWorkUsedNodes uses — so controller
      // membership and require-corroboration cannot disagree (`use .` and
      // normalized ../-forms included).
      const ctlDir = dirOf(rel);
      const rec = {
        id: `ctl:go_work:${ctlDir}`, controllerType: 'go_work', manifest: rel,
        membershipStatus: 'parsed', diagnostics: [], members: [],
      };
      const confirmedIds = new Set();
      for (const u of p.data.uses) {
        const useDir = normalizeRel(ctlDir, u.path);
        if (useDir === null) {
          // §3.5: a real parent escape points outside the scanned corpus, so
          // the member set is UNPROVABLE from what was enumerated — a
          // membership failure, never a provable non-match ('parsed')
          rec.membershipStatus = 'partial';
          rec.diagnostics.push({ construct: 'use outside corpus', value: u.path.replace(/^\.\//, '') });
          markPartial(rel, u.line, `use outside corpus: ${u.path.slice(0, 80)}`);
          continue;
        }
        const target = nodeByManifest.get(useDir === '.' ? 'go.mod' : `${useDir}/go.mod`);
        if (target && target.ecosystem === 'go') confirmedIds.add(target.id);
        else rec.diagnostics.push({ construct: 'unmatched member pattern', value: u.path.replace(/^\.\//, '') });
      }
      rec.members = [...confirmedIds].sort();
      for (const nid of confirmedIds) {
        if (!confirmations.has(nid)) confirmations.set(nid, new Set());
        confirmations.get(nid).add(rec.id);
      }
      // §3.3: any membership/use-related parse failure means the member set may
      // be incomplete — partial, never "parsed and genuinely empty/complete".
      // The parser owns the domain classification (membershipUnsupported), so
      // unrelated failures (foreign directives, replace) never pollute it.
      for (const u of p.data.membershipUnsupported) {
        rec.membershipStatus = 'partial';
        rec.diagnostics.push({ construct: u.construct, value: `line ${u.line}` });
      }
      controllers.push(rec);
    }
  }
  controllers.sort((a, b) => cmp(a.id, b.id));

  // --- roles ---------------------------------------------------------------
  for (const node of nodes.values()) {
    const dir = node.id.slice(`ws:${node.ecosystem}:`.length);
    if (dir === '.') node.role = 'standalone_root';
    else if (confirmations.has(node.id)) node.role = 'confirmed_workspace';
    else node.role = 'candidate_workspace';
  }

  // architectural node set (§3.4): single definition used everywhere
  const archSet = new Set();
  const candidateSet = new Set();
  for (const node of nodes.values()) {
    if (node.role === 'standalone_root' || node.role === 'confirmed_workspace') archSet.add(node.id);
    else candidateSet.add(node.id);
  }
  if (opts.includeCandidates) {
    for (const id of candidateSet) archSet.add(id);
    candidateSet.clear();
  }

  // name → ids lookups per ecosystem, split arch / candidate-shadow
  const archByName = new Map(); // `${eco}\u0000${name}` → [ids]
  const shadowByName = new Map();
  const keyOf = (eco, name) => `${eco}\u0000${name}`;
  for (const node of nodes.values()) {
    if (node.name === null) continue;
    const rawName = node.ecosystem === 'python' ? pep503Normalize(node.name) : node.name;
    const k = keyOf(node.ecosystem, rawName);
    const bucket = archSet.has(node.id) ? archByName : shadowByName;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(node.id);
  }
  for (const arr of archByName.values()) arr.sort();
  for (const arr of shadowByName.values()) arr.sort();

  // go module path lookup (any in-corpus go.mod, arch or not — module identity
  // is a fact of the corpus, not of the architectural set)
  const goModulesByPath = new Map(); // module path → [node ids]
  for (const node of nodes.values()) {
    if (node.ecosystem === 'go' && node.name) {
      if (!goModulesByPath.has(node.name)) goModulesByPath.set(node.name, []);
      goModulesByPath.get(node.name).push(node.id);
    }
  }
  for (const arr of goModulesByPath.values()) arr.sort();

  // go.work replace blocklist. Collection only — an orphan or version-mismatched
  // replace produces no record at all (§3.6); coverage/diagnostics attribution to
  // the go.work side happens lazily when a replace actually blocks a require.
  const goWorkReplaces = []; // {oldModule, oldVersion, controllerId, manifest, line}
  for (const [rel, p] of parsed) {
    if (p.kind !== 'go.work') continue;
    const ctl = controllers.find(c => c.controllerType === 'go_work' && c.manifest === rel);
    for (const rep of p.data.replaces) {
      goWorkReplaces.push({ ...rep, controllerId: ctl ? ctl.id : null, manifest: rel });
    }
  }
  // One record per replace declaration, however many requires it blocks.
  const blockRecordsSeen = new Set();
  function recordGoWorkBlock(rep) {
    const key = `${rep.manifest}:${rep.line}`;
    if (blockRecordsSeen.has(key)) return;
    blockRecordsSeen.add(key);
    markPartial(rep.manifest, rep.line, `go.work replace: ${rep.oldModule}`);
    const ctl = controllers.find(c => c.id === rep.controllerId);
    if (ctl) ctl.diagnostics.push({ construct: 'go.work replace', value: rep.oldModule });
  }
  function recordGoModBlock(manifest, rep) {
    const key = `${manifest}:${rep.line}`;
    if (blockRecordsSeen.has(key)) return;
    blockRecordsSeen.add(key);
    markPartial(manifest, rep.line, `module-to-module replace: ${rep.oldModule}`);
  }
  // go.work use corroboration binds to the USED DIRECTORY's node, not to every
  // same-named module in the corpus: module path → Set(node ids of used dirs).
  // Derived from the go_work controllers' CONFIRMED members — never re-derived
  // from raw use paths — so corroboration is a subset of confirmed membership
  // by construction (§3.4: a local edge can only point into what the
  // architectural set can contain).
  const goWorkUsedNodes = new Map();
  for (const ctl of controllers) {
    if (ctl.controllerType !== 'go_work' || !ctl.members) continue;
    for (const nid of ctl.members) {
      const target = nodes.get(nid);
      if (target && target.name) {
        if (!goWorkUsedNodes.has(target.name)) goWorkUsedNodes.set(target.name, new Set());
        goWorkUsedNodes.get(target.name).add(nid);
      }
    }
  }

  // --- edge resolution -----------------------------------------------------
  const edges = [];
  const unresolved = [];
  const externals = new Map(); // id → {id,name,ecosystem}

  function normalizeRel(baseDir, relPath) {
    const joined = path.posix.normalize(path.posix.join(baseDir === '.' ? '' : baseDir, relPath));
    if (joined === '' || joined === '.') return '.';
    // only a real parent-escape is out of bounds: a directory literally named
    // `..cache` starts with '..' but lives inside the corpus
    if (joined === '..' || joined.startsWith('../')) return null;
    return joined;
  }

  function addExternal(eco, name) {
    const id = `ext:${eco}:${name}`;
    if (!externals.has(id)) externals.set(id, { id, name, ecosystem: eco });
    return id;
  }

  function pushEdge(from, to, scope, resolution, evidence, condition) {
    edges.push({ from, to, relation: 'declares_dependency', scope, resolution, evidence, condition: condition ?? null });
  }

  function pushUnresolved(from, eco, name, rawSpec, reqPath, reason, candidates, evidence) {
    unresolved.push({
      from,
      requested: {
        ecosystem: eco, name,
        rawSpec: String(rawSpec).slice(0, RAW_SPEC_LIMIT),
        path: reqPath ?? null,
      },
      reason,
      candidates: [...candidates].sort(),
      evidence,
    });
  }

  // path validation (§3.6): declared path → local edge or one failure reason
  function resolvePathForm({ fromId, eco, name, rawSpec, declPath, baseDir, evidence, scope, condition, expectManifest, moduleIdentity }) {
    const relDir = normalizeRel(baseDir, declPath);
    if (relDir === null) {
      // path escapes the repo root lexically — check physically below via join
    }
    const absTarget = path.resolve(root, baseDir === '.' ? '' : baseDir, declPath);
    let real;
    try {
      real = fs.realpathSync(absTarget);
    } catch {
      pushUnresolved(fromId, eco, name, rawSpec, declPath, 'missing_target', [], evidence);
      return;
    }
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      pushUnresolved(fromId, eco, name, rawSpec, declPath, 'outside_corpus', [], evidence);
      return;
    }
    const relFromRoot = path.relative(realRoot, real).split(path.sep).join('/') || '.';
    const manifestRel = relFromRoot === '.' ? expectManifest : `${relFromRoot}/${expectManifest}`;
    const targetNode = nodeByManifest.get(manifestRel);
    if (targetNode) {
      if (moduleIdentity && targetNode.name !== moduleIdentity) {
        pushUnresolved(fromId, eco, name, rawSpec, declPath, 'target_not_in_corpus', [], evidence);
        return;
      }
      pushEdge(fromId, targetNode.id, scope, 'local', evidence, condition);
      return;
    }
    if (skippedBudgetTargets.has(manifestRel)) {
      pushUnresolved(fromId, eco, name, rawSpec, declPath, 'budget_skipped_target', [], evidence);
      return;
    }
    if (unreadableTargets.has(manifestRel)) {
      pushUnresolved(fromId, eco, name, rawSpec, declPath, 'unreadable_target', [], evidence);
      return;
    }
    pushUnresolved(fromId, eco, name, rawSpec, declPath, 'target_not_in_corpus', [], evidence);
  }

  // registry form (§3.6): two-collection judgment; rust never collects
  function resolveRegistry({ fromId, eco, name, rawSpec, evidence, scope, condition, nodeSub }) {
    if (eco === 'rust') {
      const extId = addExternal(eco, name);
      pushEdge(fromId, extId, scope, 'external', evidence, condition);
      return;
    }
    const lookupName = eco === 'python' ? pep503Normalize(name) : name;
    const arch = archByName.get(keyOf(eco, lookupName)) ?? [];
    const shadows = shadowByName.get(keyOf(eco, lookupName)) ?? [];
    if (arch.length > 1) {
      pushUnresolved(fromId, eco, name, rawSpec, null, 'ambiguous', arch, evidence);
      return;
    }
    if (arch.length === 1) {
      if (eco === 'node' && nodeSub === 'star') {
        pushEdge(fromId, arch[0], scope, 'local', evidence, condition);
      } else {
        pushUnresolved(fromId, eco, name, rawSpec, null, 'unverified_workspace_match', arch, evidence);
      }
      return;
    }
    if (shadows.length > 0) {
      pushUnresolved(fromId, eco, name, rawSpec, null, 'unverified_workspace_match', shadows, evidence);
      return;
    }
    const extId = addExternal(eco, name);
    pushEdge(fromId, extId, scope, 'external', evidence, condition);
  }

  // Cargo template lookup: nearest confirming cargo_workspace controller
  function findCargoTemplate(node) {
    const confirming = [...(confirmations.get(node.id) ?? [])]
      .map(cid => controllers.find(c => c.id === cid))
      .filter(c => c && c.controllerType === 'cargo_workspace');
    if (confirming.length === 0) return null;
    confirming.sort((a, b) => dirOf(b.manifest).length - dirOf(a.manifest).length || cmp(a.id, b.id));
    const ctl = confirming[0];
    const p = parsed.get(ctl.manifest);
    if (!p || p.kind !== 'rust') return null;
    return { controller: ctl, templates: p.data.templates };
  }

  for (const [rel, p] of parsed) {
    const node = nodeByManifest.get(rel);

    if (p.kind === 'node' && node) {
      for (const dep of p.data.deps) {
        const evidence = { declaration: { manifest: rel, line: dep.line } };
        const cls = classifyNodeSpec(dep.spec);
        if (cls.kind === 'path') {
          resolvePathForm({
            fromId: node.id, eco: 'node', name: dep.name, rawSpec: dep.spec,
            declPath: cls.path, baseDir: dirOf(rel), evidence, scope: dep.scope,
            condition: null, expectManifest: 'package.json',
          });
        } else if (cls.kind === 'workspace-intent') {
          const arch = archByName.get(keyOf('node', dep.name)) ?? [];
          if (arch.length === 0) {
            pushUnresolved(node.id, 'node', dep.name, dep.spec, null, 'missing_workspace_member', [], evidence);
          } else if (arch.length === 1) {
            pushEdge(node.id, arch[0], dep.scope, 'local', evidence, null);
          } else {
            pushUnresolved(node.id, 'node', dep.name, dep.spec, null, 'ambiguous', arch, evidence);
          }
        } else if (cls.kind === 'registry') {
          resolveRegistry({
            fromId: node.id, eco: 'node', name: dep.name, rawSpec: dep.spec,
            evidence, scope: dep.scope, condition: null, nodeSub: cls.sub,
          });
        } else {
          markPartial(rel, dep.line, `unsupported dependency spec: ${dep.name} = ${dep.spec.slice(0, 80)}`);
        }
      }
    }

    if (p.kind === 'php' && node) {
      for (const dep of p.data.deps) {
        const evidence = { declaration: { manifest: rel, line: dep.line } };
        resolveRegistry({
          fromId: node.id, eco: 'php', name: dep.name, rawSpec: dep.spec,
          evidence, scope: dep.scope, condition: null,
        });
      }
    }

    if (p.kind === 'python' && node) {
      for (const dep of p.data.pyDeps) {
        const extracted = extractPyDepName(dep.raw);
        if (!extracted.ok) {
          markPartial(rel, dep.line, `unsupported dependency string: ${dep.raw.slice(0, 80)}`);
          continue;
        }
        const evidence = { declaration: { manifest: rel, line: dep.line } };
        resolveRegistry({
          fromId: node.id, eco: 'python', name: extracted.name, rawSpec: dep.raw,
          evidence, scope: dep.scope, condition: null,
        });
      }
    }

    if (p.kind === 'go' && node) {
      const localReplaces = p.data.replaces;
      for (const req of p.data.requires) {
        const evidence = { declaration: { manifest: rel, line: req.line } };
        const applicable = r => r.oldModule === req.module
          && (r.oldVersion === null || r.oldVersion === req.version);
        // blockers first: applicable module-to-module replaces (go.mod) and any
        // applicable go.work replaces — v1 does not simulate redirection, and
        // EVERY independently applicable blocker source gets its own record
        const modBlockers = localReplaces.filter(r => applicable(r) && r.targetKind === 'module');
        const workBlockers = goWorkReplaces.filter(applicable);
        if (modBlockers.length > 0 || workBlockers.length > 0) {
          for (const b of modBlockers) recordGoModBlock(rel, b);
          for (const b of workBlockers) recordGoWorkBlock(b);
          continue; // no edge, no unresolved (§3.3 division of records)
        }
        const rep = localReplaces.find(r => applicable(r) && r.targetKind === 'path');
        if (rep) {
          resolvePathForm({
            fromId: node.id, eco: 'go', name: req.module, rawSpec: `${req.module} ${req.version}`,
            declPath: rep.targetPath, baseDir: dirOf(rel), evidence, scope: 'runtime',
            condition: null, expectManifest: 'go.mod', moduleIdentity: req.module,
          });
          continue;
        }
        const usedIds = goWorkUsedNodes.get(req.module);
        if (usedIds) {
          const ids = [...usedIds].sort();
          if (ids.length === 1) {
            pushEdge(node.id, ids[0], 'runtime', 'local', evidence, null);
          } else {
            pushUnresolved(node.id, 'go', req.module, `${req.module} ${req.version}`, null, 'ambiguous', ids, evidence);
          }
          continue;
        }
        const inCorpus = goModulesByPath.get(req.module) ?? [];
        if (inCorpus.length > 0) {
          pushUnresolved(node.id, 'go', req.module, `${req.module} ${req.version}`, null, 'unverified_workspace_match', inCorpus, evidence);
          continue;
        }
        const extId = addExternal('go', req.module);
        pushEdge(node.id, extId, 'runtime', 'external', evidence, null);
      }
      // orphan replaces (no matching require) produce no records at all
    }

    if (p.kind === 'rust' && node) {
      for (const dep of p.data.deps) {
        const targetName = dep.form === 'table' && typeof dep.fields.package === 'string'
          ? dep.fields.package : dep.name;
        const evidence = { declaration: { manifest: rel, line: dep.line } };
        const scope = dep.form === 'table' && dep.fields.optional === true ? 'optional' : dep.scope;
        if (dep.form === 'version') {
          resolveRegistry({
            fromId: node.id, eco: 'rust', name: targetName, rawSpec: dep.rawSpec,
            evidence, scope, condition: dep.condition,
          });
          continue;
        }
        // inline table
        if (dep.fields.workspace === true) {
          // template inheritance (§3.6): expand first, classify after
          const tpl = findCargoTemplate(node);
          const entry = tpl ? tpl.templates.find(t => t.name === dep.name) : undefined;
          if (!tpl || !entry) {
            pushUnresolved(node.id, 'rust', targetName, dep.rawSpec, null, 'missing_workspace_template', [],
              { declaration: { manifest: rel, line: dep.line }, template: null });
            continue;
          }
          const tplEvidence = {
            declaration: { manifest: rel, line: dep.line },
            template: { manifest: tpl.controller.manifest, line: entry.line },
          };
          // the template's own `package` rename is the real target identity;
          // it wins over the member key when the template declares one
          const tplName = entry.form === 'table' && typeof entry.fields.package === 'string'
            ? entry.fields.package : targetName;
          if (entry.form === 'table' && typeof entry.fields.path === 'string') {
            resolvePathForm({
              fromId: node.id, eco: 'rust', name: tplName, rawSpec: dep.rawSpec,
              declPath: entry.fields.path, baseDir: dirOf(tpl.controller.manifest),
              evidence: tplEvidence, scope, condition: dep.condition, expectManifest: 'Cargo.toml',
            });
          } else if (entry.form === 'version'
            || (entry.form === 'table' && typeof entry.fields.version === 'string' && entry.fields.path === undefined && entry.fields.workspace === undefined)) {
            const extId = addExternal('rust', tplName);
            pushEdge(node.id, extId, scope, 'external', tplEvidence, dep.condition);
          } else {
            markPartial(rel, dep.line, `workspace = true → unsupported template entry: ${dep.name}`);
          }
          continue;
        }
        if (typeof dep.fields.path === 'string') {
          resolvePathForm({
            fromId: node.id, eco: 'rust', name: targetName, rawSpec: dep.rawSpec,
            declPath: dep.fields.path, baseDir: dirOf(rel), evidence, scope,
            condition: dep.condition, expectManifest: 'Cargo.toml',
          });
          continue;
        }
        if (typeof dep.fields.version === 'string') {
          resolveRegistry({
            fromId: node.id, eco: 'rust', name: targetName, rawSpec: dep.rawSpec,
            evidence, scope, condition: dep.condition,
          });
          continue;
        }
        markPartial(rel, dep.line, `dependency table without version/path/workspace: ${dep.name}`);
      }
    }
  }

  // --- deterministic ordering ----------------------------------------------
  const edgeKey = e => [e.from, e.to, e.scope, e.condition ?? ''];
  edges.sort((a, b) => {
    const ka = edgeKey(a); const kb = edgeKey(b);
    for (let i = 0; i < 4; i++) { const c = cmp(ka[i], kb[i]); if (c) return c; }
    return 0;
  });
  unresolved.sort((a, b) => cmp(a.from, b.from) || cmp(a.requested.name, b.requested.name)
    || cmp(a.evidence.declaration.line ?? 0, b.evidence.declaration.line ?? 0));

  const workspaces = [...nodes.values()].sort((a, b) => cmp(a.id, b.id));
  const externalList = [...externals.values()].sort((a, b) => cmp(a.id, b.id));
  const coverageList = [...coverage.entries()]
    .map(([manifest, c]) => ({ manifest, ...c }))
    .sort((a, b) => cmp(a.manifest, b.manifest));

  return {
    root, workspaces, controllers, externals: externalList, edges,
    unresolvedDeclarations: unresolved, coverage: coverageList,
    omissions, diagnostics, archSet, candidateSet, nodes,
  };
}

// ---------------------------------------------------------------------------
// Queries (§3.8)
// ---------------------------------------------------------------------------

function resolveSelector(map, selector) {
  const all = [...map.workspaces.filter(w => map.archSet.has(w.id)), ...map.externals];
  if (selector.startsWith('ws:') || selector.startsWith('ext:')) {
    const hit = all.find(n => n.id === selector);
    return hit ? { ids: [hit.id] } : { ids: [] };
  }
  let matches;
  if (selector.includes(':')) {
    const sep = selector.indexOf(':');
    const eco = selector.slice(0, sep);
    const name = selector.slice(sep + 1);
    matches = all.filter(n => n.ecosystem === eco && n.name === name);
  } else {
    matches = all.filter(n => n.name === selector);
  }
  return { ids: matches.map(n => n.id).sort() };
}

function reverseQuery(map, targetId) {
  // only architectural sources: a candidate's edge must not leak into the
  // default reverse view (candidates enter archSet via --include-candidates)
  return map.edges.filter(e => e.to === targetId && map.archSet.has(e.from))
    .sort((a, b) => cmp(a.from, b.from));
}

// Iterative Tarjan SCC over architectural local edges (explicit stack — §3.8)
function findCycles(map) {
  // dedupe edges by (from,to,scope,condition); only local edges among arch nodes
  const seen = new Set();
  const localEdges = [];
  for (const e of map.edges) {
    if (e.resolution !== 'local') continue;
    if (!map.archSet.has(e.from) || !map.archSet.has(e.to)) continue;
    const k = `${e.from}\u0000${e.to}\u0000${e.scope}\u0000${e.condition ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    localEdges.push(e);
  }
  const adj = new Map();
  for (const id of map.archSet) adj.set(id, []);
  const selfLoops = [];
  for (const e of localEdges) {
    if (e.from === e.to) { selfLoops.push(e); continue; }
    adj.get(e.from).push(e.to);
  }
  for (const list of adj.values()) list.sort();

  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  let counter = 0;
  const sccs = [];

  for (const start of [...adj.keys()].sort()) {
    if (index.has(start)) continue;
    const work = [{ node: start, childIdx: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame.node;
      if (frame.childIdx === 0) {
        index.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
      }
      const children = adj.get(v);
      let recursed = false;
      while (frame.childIdx < children.length) {
        const w = children[frame.childIdx];
        frame.childIdx++;
        if (!index.has(w)) {
          work.push({ node: w, childIdx: 0 });
          recursed = true;
          break;
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v), index.get(w)));
        }
      }
      if (recursed) continue;
      if (low.get(v) === index.get(v)) {
        const comp = [];
        for (;;) {
          const w = stack.pop();
          onStack.delete(w);
          comp.push(w);
          if (w === v) break;
        }
        if (comp.length > 1) sccs.push(comp);
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
    }
  }

  const classify = scopes => {
    const set = new Set(scopes);
    if (set.size === 1 && set.has('runtime')) return 'runtime';
    if (set.size === 1 && set.has('development')) return 'development';
    return 'mixed';
  };
  const edgeSort = (a, b) => cmp(a.from, b.from) || cmp(a.to, b.to)
    || cmp(a.scope, b.scope)
    || cmp(String(a.condition ?? ''), String(b.condition ?? ''));

  const results = [];
  for (const comp of sccs) {
    const nodeSet = new Set(comp);
    const internal = localEdges.filter(e => nodeSet.has(e.from) && nodeSet.has(e.to) && e.from !== e.to);
    results.push({
      classification: classify(internal.map(e => e.scope)),
      nodes: [...comp].sort(),
      edges: internal.sort(edgeSort),
      selfLoop: false,
    });
  }
  for (const e of selfLoops) {
    results.push({
      classification: classify([e.scope]),
      nodes: [e.from],
      edges: [e],
      selfLoop: true,
    });
  }
  // inter-cycle ordering: min member id, tie → full sorted node list
  results.sort((a, b) => cmp(a.nodes[0], b.nodes[0])
    || cmp(a.nodes.join('\u0000'), b.nodes.join('\u0000')));
  return results;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function buildEnvelope(map, query) {
  return {
    schemaVersion: 1,
    query,
    artifact: {
      generatedAt: new Date().toISOString(),
      root: map.root,
      workspaces: map.workspaces,
      controllers: map.controllers,
      externals: map.externals,
      edges: map.edges,
      unresolvedDeclarations: map.unresolvedDeclarations,
      coverage: map.coverage,
      omissions: map.omissions,
      diagnostics: map.diagnostics,
    },
  };
}

// C0/DEL escaped so a hostile path cannot smuggle terminal control sequences
// or line/section breaks into the md projection (json is untouched).
function mdSafe(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]/g,
    ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// Backtick-aware code span: fence one longer than the longest backtick run in
// the content, computed in a single pass (a grow-and-rescan loop is quadratic
// on hostile all-backtick names within the 1 MiB manifest budget).
function mdCode(s) {
  const safe = mdSafe(s);
  let maxRun = 0;
  let run = 0;
  for (let i = 0; i < safe.length; i++) {
    if (safe[i] === '`') { run++; if (run > maxRun) maxRun = run; }
    else run = 0;
  }
  if (maxRun === 0) return `\`${safe}\``;
  const fence = '`'.repeat(maxRun + 1);
  return `${fence} ${safe} ${fence}`;
}

function renderMd(map, opts, query, results) {
  const L = [];
  const top = opts.top;
  const trunc = (arr, render) => {
    const shown = arr.slice(0, top).map(render);
    if (arr.length > top) shown.push(`… (${arr.length - top} more omitted; --top ${top})`);
    return shown;
  };
  L.push('# Manifest Map（宣告依賴地圖）');
  L.push('');
  if (query.kind === 'reverse') {
    L.push(`## Reverse declares_dependency → ${mdCode(query.selector)}（depth=1）`);
    L.push('');
    if (results.length === 0) L.push('（無直接反向宣告）');
    else L.push(...trunc(results, e => `- ${mdCode(e.from)} —(${e.scope})→ ${mdCode(e.to)}`));
    L.push('');
    L.push('> 邊語義：declares_dependency（宣告依賴）。不證明 import 或 runtime 影響。');
    return L.join('\n');
  }
  if (query.kind === 'cycles') {
    L.push('## Manifest cycles（宣告環）');
    L.push('');
    if (results.length === 0) L.push('（無宣告環）');
    for (const c of results.slice(0, top)) {
      L.push(`- [${c.classification}]${c.selfLoop ? ' [self-loop]' : ''} ${c.nodes.map(mdCode).join(' → ')}`);
    }
    if (results.length > top) L.push(`… (${results.length - top} more omitted; --top ${top})`);
    L.push('');
    L.push('> 邊語義：declares_dependency（宣告依賴）。不證明 import 或 runtime 影響。');
    return L.join('\n');
  }
  // overview
  const byRole = role => map.workspaces.filter(w => w.role === role);
  L.push('## Workspace inventory');
  L.push('');
  for (const role of ['standalone_root', 'confirmed_workspace', 'candidate_workspace']) {
    const list = byRole(role);
    if (list.length === 0) continue;
    L.push(`### ${role} (${list.length})`);
    L.push(...trunc(list, w => `- ${mdCode(w.id)}${w.name ? ` — ${mdCode(w.name)}` : ''}${w.flags.includes('likely_fixture') ? ' _(likely_fixture)_' : ''}`));
    L.push('');
  }
  L.push('## 架構計數');
  L.push('');
  L.push(`- 架構節點集（standalone_root + confirmed${opts.includeCandidates ? ' + candidates' : ''}）：${map.archSet.size}`);
  L.push(`- candidate（預設排除）：${map.candidateSet.size}`);
  L.push(`- controllers：${map.controllers.length}`);
  L.push('');
  // §3.4: both endpoints must be architecture nodes — the JSON artifact keeps
  // the full edge; the overview only widens via --include-candidates
  const localEdges = map.edges.filter(e => e.resolution === 'local'
    && map.archSet.has(e.from) && map.archSet.has(e.to));
  L.push(`## Local 宣告邊 Top-${top}（共 ${localEdges.length}）`);
  L.push('');
  L.push(...trunc(localEdges, e => `- ${mdCode(e.from)} —(${e.scope})→ ${mdCode(e.to)}`));
  L.push('');
  L.push('## 摘要');
  L.push('');
  L.push(`- 外部依賴（distinct）：${map.externals.length}`);
  L.push(`- unresolved 宣告：${map.unresolvedDeclarations.length}`);
  const covCounts = {};
  for (const c of map.coverage) covCounts[c.status] = (covCounts[c.status] ?? 0) + 1;
  L.push(`- coverage：${Object.entries(covCounts).sort().map(([k, v]) => `${k}=${v}`).join('，') || '（無 manifest）'}`);
  for (const o of map.omissions) {
    L.push(`- omissions：${o.reason} ×${o.count}（sample：${o.sample.slice(0, 3).map(mdCode).join('、')}…）`);
  }
  L.push('');
  L.push('> 邊語義：declares_dependency（宣告依賴）。宣告不證明 import 或 runtime 影響。');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { root } = detectRepoRoot(process.cwd());
  const map = buildMap(root, opts);

  if (opts.format === 'json' && opts.topSet) {
    map.diagnostics.push({ code: 'top_ignored_in_json' });
  }

  let query;
  let results = [];
  if (opts.mode === 'reverse') {
    const { ids } = resolveSelector(map, opts.selector);
    if (ids.length === 0) {
      process.stderr.write(`selector not found: ${opts.selector}\n`);
      process.exit(2);
    }
    if (ids.length > 1) {
      process.stderr.write(`ambiguous selector: ${opts.selector}\nmatches:\n${ids.map(i => `  ${i}`).join('\n')}\n`);
      process.exit(2);
    }
    results = reverseQuery(map, ids[0]);
    query = { kind: 'reverse', selector: ids[0], results };
  } else if (opts.mode === 'cycles') {
    results = findCycles(map);
    query = { kind: 'cycles', results };
  } else {
    query = { kind: 'overview' };
  }

  if (opts.format === 'json') {
    process.stdout.write(JSON.stringify(buildEnvelope(map, query), null, 2) + '\n');
  } else {
    process.stdout.write(renderMd(map, opts, query, results) + '\n');
  }
}

if (require.main === module) main();
