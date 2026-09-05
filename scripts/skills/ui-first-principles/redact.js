'use strict';

/**
 * redact.js — Structure-aware PII redaction for ui-first-principles skill.
 *
 * Tech spec: docs/features/ui-first-principles/2-tech-spec.md §3.4 Phase 1
 *
 * Pipeline:
 *   1. Pre-collect base-layer fingerprints (matchAll HIGH + MEDIUM base patterns,
 *      dedup by fingerprint to avoid double-count when a value matches multiple patterns)
 *   2. Call security-redact base layer (AbortError propagates on high-confidence)
 *   3. Structure-aware masking:
 *      - JSON sample: JSON.parse + walkAndMask with (path, fieldName, value) context
 *      - Fallback: regex key=value scan (JSON parse failure or inputFormat=manual_list)
 *
 * Classification precedence in decideLeaf (strictest first):
 *   a. PLACEHOLDER_RE short-circuit — already-masked values never re-classified
 *   b. Value-pattern PII (email, national_id, strict E.164 phone) — beats crypto allowlist
 *   c. Crypto allowlist (opt-in: domain=crypto AND field-name match, fail-safe)
 *   d. Field-name PII (phone, address, account_id, credential) with
 *      camelCase/snake_case-aware token boundaries to avoid substring false positives
 *      (e.g., "ipaddress" no longer matches address PII).
 *
 * Output: PhaseOneRedactResult { maskedText, fingerprints, fieldDecisions, summary }
 */

const nodeCrypto = require('node:crypto');
const {
  redact: baseRedact,
  HIGH_CONFIDENCE_PATTERNS,
  MEDIUM_CONFIDENCE_PATTERNS,
} = require('../../security-redact');

// ---------- Constants ----------

const PLACEHOLDER_RE = /^(?:\[REDACTED\]|<redacted:[a-z_]+>)$/;

// Value-pattern PII
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const TAIWAN_ID_RE = /^[A-Z][12]\d{8}$/;
const SSN_RE = /^\d{3}-\d{2}-\d{4}$/;
// Strict E.164: must begin with `+`. Digits-only values rely on field-name match
// to avoid masking things like token IDs or numeric identifiers as phones.
const E164_RE = /^\+\d{8,15}$/;

// Field-name PII (anchored on snake_case / camelCase token boundaries).
// Input to these regexes is `normalizeFieldName(fn)` — camelCase is lowercased with
// underscores inserted (e.g., `billingAddress` → `billing_address`), so `(^|_)address($|_)`
// reliably matches tokens and rejects substrings like `ipaddress` (single token).
const PHONE_FIELD_RE = /(^|_)(phone|mobile|tel)($|_)/;
const ADDRESS_FIELD_RE = /(^|_)(address|addr|street|city|postal|zipcode|zip)($|_)/;
const ACCOUNT_FIELD_RE =
  /(?:(^|_)account($|_)|(^|_)(user|customer|member|client)_?id($|_))/;
const CREDENTIAL_FIELD_RE =
  /(^|_)(password|passwd|pwd|secret|api_?key|access_?token|private_?key|token|credentials?)($|_)/;

// Crypto allowlist (opt-in via --domain crypto, double-condition: flag AND field name).
// Field regexes are token-anchored on `normalizeFieldName(fn)` so that substring
// collisions (e.g., `ipaddress`, `emailaddress`, `subcontract`, `homeowner`,
// `operatorName`, `txNonce`) do not accidentally enable the crypto allowlist.
const ETH_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ETH_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const CRYPTO_ADDR_FIELD_RE =
  /(^|_)(address|from|to|contract|owner|spender|operator|recipient)($|_)/;
// `hash` / `txhash` / `blockhash` as tokens cover every real tx-hash field name
// after normalizeFieldName (e.g., `txHash` → `tx_hash`, `transactionHash` →
// `transaction_hash`). A bare `tx` is matched only when it is the *entire*
// field name (`^tx$`) so that non-hash `tx`-prefixed fields like `txNonce`
// (→ `tx_nonce`) or `txType` (→ `tx_type`) do not spuriously allowlist.
const CRYPTO_HASH_FIELD_RE = /(^|_)(hash|txhash|blockhash)($|_)|^tx$/;
const TOKEN_ID_FIELD_RE = /(^|_)token_?id($|_)/;

// ---------- Public API ----------

/**
 * Redact PII and secrets from input text, returning a structured result.
 *
 * @param {string} rawText - Raw input (JSON string or manual-list text)
 * @param {object} [options]
 * @param {'crypto'|null} [options.domain=null] - Opt-in crypto allowlist; defaults fail-safe off
 * @param {'json_sample'|'manual_list'} [options.inputFormat='json_sample']
 * @returns {{
 *   maskedText: string,
 *   fingerprints: Set<string>,
 *   fieldDecisions: Array<{path:string, fieldName:string, action:'keep'|'mask'|'crypto_allow', piiClass?:string, fingerprint?:string}>,
 *   summary: {totalMasks:number, maskedClasses:string[], cryptoAllowlistHits:number, baseRedactHits:number},
 * }}
 * @throws {AbortError} from scripts/security-redact.js when a high-confidence secret is detected
 */
function redact(rawText, options = {}) {
  const { domain = null, inputFormat = 'json_sample' } = options;
  const ctx = {
    domain,
    fingerprints: new Set(),
    fieldDecisions: [],
    summary: {
      totalMasks: 0,
      maskedClasses: new Set(),
      cryptoAllowlistHits: 0,
      baseRedactHits: 0,
    },
  };

  if (typeof rawText !== 'string') {
    return finalizeResult('', ctx);
  }

  // Step 1: pre-collect base-layer fingerprints BEFORE masking
  collectBaseLayerFingerprints(rawText, ctx);

  // Step 2: base secret scan (AbortError on high-confidence propagates to caller)
  const baseMasked = baseRedact(rawText);

  // Step 3: structure-aware masking
  if (inputFormat === 'json_sample') {
    let root;
    try {
      root = JSON.parse(baseMasked);
    } catch {
      return fallbackStringMode(baseMasked, ctx);
    }
    const masked = walkAndMask(root, '', ctx);
    return finalizeResult(JSON.stringify(masked, null, 2), ctx);
  }

  return fallbackStringMode(baseMasked, ctx);
}

// ---------- Base-layer fingerprint pre-collection ----------

function collectBaseLayerFingerprints(rawText, ctx) {
  const allPatterns = [...HIGH_CONFIDENCE_PATTERNS, ...MEDIUM_CONFIDENCE_PATTERNS];
  for (const entry of allPatterns) {
    const { re, group } = entry;
    // Always clone to a fresh regex with explicit `g` flag. This defends against:
    //   1. Stale lastIndex on shared global regex objects
    //   2. Accidental flag concatenation (re.flags.includes('g') guard)
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const freshRe = new RegExp(re.source, flags);
    for (const m of rawText.matchAll(freshRe)) {
      const captured = typeof group === 'number' ? m[group] : m[0];
      if (!captured) continue;
      const fp = sha256Prefix(captured);
      if (!ctx.fingerprints.has(fp)) {
        ctx.fingerprints.add(fp);
        ctx.summary.baseRedactHits += 1;
      }
    }
  }
}

// ---------- Structure-aware traversal ----------

function walkAndMask(node, path, ctx) {
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') return decideLeaf(path, node, ctx);
  if (Array.isArray(node)) {
    return node.map((v, i) => walkAndMask(v, `${path}[${i}]`, ctx));
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = walkAndMask(v, path ? `${path}.${k}` : k, ctx);
  }
  return out;
}

function decideLeaf(path, value, ctx) {
  if (typeof value !== 'string') return value;
  const fieldName = extractFieldName(path);
  const trace = { path, fieldName, action: 'keep' };
  // Trim once for all classification decisions so that JSON values with
  // surrounding whitespace (legal in JSON strings) cannot slip past anchored
  // patterns (EMAIL_RE / TAIWAN_ID_RE / SSN_RE / E164_RE) and fall through to
  // the crypto allowlist. Output path still returns the untrimmed `value` so
  // non-PII leaves keep their original formatting.
  const trimmed = value.trim();

  // a. Placeholder short-circuit — never re-classify already-masked values. A value the base layer
  //     already caught and masked to `[REDACTED]` is returned as-is, uncounted in `maskedClasses`:
  //     layered defense, not double masking. This is deliberate and symmetric with the manual/KV
  //     text path below — reverted here 2026-09-05 after a relabel patch (2026-09-04) broke that
  //     symmetry: it made the JSON path emit `<redacted:credential>` for a base-caught value while
  //     the KV path kept `[REDACTED]`, so the same credential classified differently depending only
  //     on which input mode carried it, contradicting this file's own pre-existing test
  //     ("fallback: base redact catches apiKey, credential class does not double-mask" —
  //     "correct cooperative behavior"). The base layer widened on 2026-09-04 to catch quoted JSON
  //     keys it previously missed; that widening is what exposed the asymmetry, not a reason to add
  //     a second one.
  if (PLACEHOLDER_RE.test(trimmed)) {
    ctx.fieldDecisions.push(trace);
    return value;
  }

  // a2. Empty / whitespace-only values carry no PII — treat as keep.
  //     Without this guard, an empty `tokenId` would fall through to
  //     `classifyByFieldName` and mask the empty string as `credential`,
  //     polluting `totalMasks` / `fingerprints` with meaningless entries.
  if (trimmed.length === 0) {
    ctx.fieldDecisions.push(trace);
    return value;
  }

  // b. Explicit value-pattern PII (email / national_id / strict E.164)
  //    Beats crypto allowlist intentionally: if a value is unmistakably PII,
  //    we mask even if the field name triggered crypto_allow.
  const valuePII = classifyByValue(trimmed);
  if (valuePII) {
    return applyMask(trace, valuePII, trimmed, ctx);
  }

  // c. Crypto allowlist (opt-in, double-condition fail-safe). Require a non-empty
  //    trimmed value so that empty / whitespace-only leaves do not pollute
  //    `cryptoAllowlistHits` with semantically meaningless entries.
  if (ctx.domain === 'crypto' && trimmed.length > 0 && isCryptoField(fieldName, trimmed)) {
    trace.action = 'crypto_allow';
    ctx.summary.cryptoAllowlistHits += 1;
    ctx.fieldDecisions.push(trace);
    return value;
  }

  // d. Field-name PII (phone, address, account_id, credential)
  const fieldPII = classifyByFieldName(fieldName);
  if (fieldPII) {
    return applyMask(trace, fieldPII, trimmed, ctx);
  }

  ctx.fieldDecisions.push(trace);
  return value;
}

// ---------- Fallback string-mode masking ----------

function fallbackStringMode(text, ctx) {
  // KV parser with 4-way value alternation so quoted PII with surrounding
  // whitespace (e.g. `ssn=' 123-45-6789 '`) is still parsed, trimmed, and
  // classified rather than silently skipped. The four value branches are
  // mutually exclusive — the active one is selected by which capture group
  // is non-undefined:
  //   A) double-quoted  "..."  — allows whitespace, terminates at " or \n
  //   B) single-quoted  '...'  — same, terminates at ' or \n
  //   C) back-quoted    `...`  — same, terminates at ` or \n (markdown/code-like input)
  //   D) bare token — excludes whitespace + all three quote chars so multi-KV
  //                   inputs on one line (`ssn=A id=B`) capture each pair
  //                   independently without greedy overreach, and backtick-
  //                   prefixed values are never truncated mid-capture.
  // `[REDACTED]` is allowed in the bare branch to preserve base-layer
  // placeholders whole so PLACEHOLDER_RE short-circuit fires.
  const KV_RE =
    /(["'`]?)([A-Za-z_][\w.-]*)\1\s*([:=])\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`|(\[REDACTED\]|[^\s"'`,}\]]+))/g;
  const masked = text.replace(
    KV_RE,
    (full, kq, fieldName, op, dqVal, sqVal, bqVal, bareVal) => {
      let rawValue;
      let q;
      if (dqVal !== undefined) {
        rawValue = dqVal;
        q = '"';
      } else if (sqVal !== undefined) {
        rawValue = sqVal;
        q = "'";
      } else if (bqVal !== undefined) {
        rawValue = bqVal;
        q = '`';
      } else {
        rawValue = bareVal;
        q = '';
      }
      const trimmed = rawValue.trim();
      const trace = { path: fieldName, fieldName, action: 'keep' };

      // Placeholder short-circuit — never re-classify a value the base layer already masked. This
      // is the file's original, deliberate design (see the pre-existing test right below this
      // function's use site), unchanged.
      if (PLACEHOLDER_RE.test(trimmed)) {
        ctx.fieldDecisions.push(trace);
        return full;
      }

      // Empty / whitespace-only values carry no PII — keep as-is.
      if (trimmed.length === 0) {
        ctx.fieldDecisions.push(trace);
        return full;
      }

      const buildMasked = (piiClass) =>
        `${kq}${fieldName}${kq}${op} ${q}<redacted:${piiClass}>${q}`;

      const valuePII = classifyByValue(trimmed);
      if (valuePII) {
        trace.action = 'mask';
        trace.piiClass = valuePII;
        trace.fingerprint = sha256Prefix(trimmed);
        ctx.fingerprints.add(trace.fingerprint);
        ctx.summary.maskedClasses.add(valuePII);
        ctx.summary.totalMasks += 1;
        ctx.fieldDecisions.push(trace);
        return buildMasked(valuePII);
      }

      if (ctx.domain === 'crypto' && isCryptoField(fieldName, trimmed)) {
        trace.action = 'crypto_allow';
        ctx.summary.cryptoAllowlistHits += 1;
        ctx.fieldDecisions.push(trace);
        return full;
      }

      const fieldPII = classifyByFieldName(fieldName);
      if (fieldPII) {
        trace.action = 'mask';
        trace.piiClass = fieldPII;
        trace.fingerprint = sha256Prefix(trimmed);
        ctx.fingerprints.add(trace.fingerprint);
        ctx.summary.maskedClasses.add(fieldPII);
        ctx.summary.totalMasks += 1;
        ctx.fieldDecisions.push(trace);
        return buildMasked(fieldPII);
      }

      ctx.fieldDecisions.push(trace);
      return full;
    },
  );
  return finalizeResult(masked, ctx);
}

// ---------- Classifiers ----------

function classifyByValue(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (EMAIL_RE.test(value)) return 'email';
  if (TAIWAN_ID_RE.test(value) || SSN_RE.test(value)) return 'national_id';
  if (E164_RE.test(value)) return 'phone';
  return null;
}

function classifyByFieldName(fieldName) {
  const n = normalizeFieldName(fieldName);
  if (PHONE_FIELD_RE.test(n)) return 'phone';
  if (ADDRESS_FIELD_RE.test(n)) return 'address';
  if (ACCOUNT_FIELD_RE.test(n)) return 'account_id';
  if (CREDENTIAL_FIELD_RE.test(n)) return 'credential';
  return null;
}

// Composition — kept for backward compatibility and direct unit testing.
function classifyField(fieldName, value) {
  const byValue = classifyByValue(value);
  if (byValue) return byValue;
  return classifyByFieldName(fieldName);
}

function isCryptoField(fieldName, value) {
  const n = normalizeFieldName(fieldName);
  const val = String(value || '');

  if (TOKEN_ID_FIELD_RE.test(n)) return true;
  if (ETH_ADDR_RE.test(val) && CRYPTO_ADDR_FIELD_RE.test(n)) return true;
  if (ETH_HASH_RE.test(val) && CRYPTO_HASH_FIELD_RE.test(n)) return true;
  return false;
}

// ---------- Helpers ----------

// Normalize camelCase → snake_case lowercased so anchored regexes can use
// `(^|_)term($|_)` to match tokens instead of substrings.
function normalizeFieldName(fn) {
  return String(fn || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function extractFieldName(path) {
  // "user.transactions[0].counterparty" → "counterparty"
  // "emails[0]" → "0" (array index; classify handles via value pattern)
  // "" → ""
  return String(path || '').split(/[.[]/).pop().replace(/]$/, '');
}

function applyMask(trace, piiClass, value, ctx) {
  trace.action = 'mask';
  trace.piiClass = piiClass;
  trace.fingerprint = sha256Prefix(value);
  ctx.fingerprints.add(trace.fingerprint);
  ctx.summary.maskedClasses.add(piiClass);
  ctx.summary.totalMasks += 1;
  ctx.fieldDecisions.push(trace);
  return `<redacted:${piiClass}>`;
}

function sha256Prefix(s) {
  const h = nodeCrypto.createHash('sha256').update(String(s)).digest('hex');
  return `sha256:${h.slice(0, 12)}`;
}

function finalizeResult(maskedText, ctx) {
  return {
    maskedText,
    fingerprints: ctx.fingerprints,
    fieldDecisions: ctx.fieldDecisions,
    summary: {
      totalMasks: ctx.summary.totalMasks,
      maskedClasses: [...ctx.summary.maskedClasses],
      cryptoAllowlistHits: ctx.summary.cryptoAllowlistHits,
      baseRedactHits: ctx.summary.baseRedactHits,
    },
  };
}

module.exports = {
  redact,
  // Exported for unit testing
  classifyField,
  classifyByValue,
  classifyByFieldName,
  isCryptoField,
  normalizeFieldName,
  PLACEHOLDER_RE,
  runCli,
};

// ---------- CLI ----------

// Invoked by SKILL.md Phase 1 as:
//   node scripts/skills/ui-first-principles/redact.js \
//     --input  <api.json|manual.txt> \
//     --domain <crypto|''> \
//     --output <phase1.json>
//
// Writes a JSON document to --output with this contract (consumed by
// normalize-input.js and validate-report.js):
//   {
//     "maskedText": "<input with PII placeholders>",
//     "forbiddenFingerprints": ["sha256:abc...", ...],
//     "fieldDecisions": [{ "path": "...", "originalSample": "<masked>", "redacted": true|false, "type": "..." }],
//     "redactionSummary": { "totalMasks": N, "byType": {...}, "cryptoAllowlistHits": M, "baseRedactHits": K }
//   }
//
// Exit code: 0 on success, 2 on argument or filesystem error. Errors also
// emit a JSON diagnostic to stdout so the caller (SKILL.md Phase 0/1) can
// surface them without parsing stderr.
function parseRedactCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '--output' || arg === '--domain' || arg === '--inputFormat') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`missing value for ${arg}`);
      }
      out[arg.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

function runCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const fs = io.fs || require('node:fs');
  const exit = io.exit || ((code) => process.exit(code));
  let args;
  try {
    args = parseRedactCliArgs(argv);
  } catch (err) {
    stderr.write(`redact: ${err.message}\n`);
    stdout.write(JSON.stringify({ ok: false, error: 'cli_args', detail: err.message }) + '\n');
    return exit(2);
  }
  if (!args.input || !args.output) {
    const msg = 'usage: --input <path> --output <phase1.json> [--domain crypto] [--inputFormat json_sample|manual_list]';
    stderr.write(`redact: ${msg}\n`);
    stdout.write(JSON.stringify({ ok: false, error: 'cli_args', detail: msg }) + '\n');
    return exit(2);
  }
  let raw;
  try {
    raw = fs.readFileSync(args.input, 'utf8');
  } catch (err) {
    stdout.write(JSON.stringify({ ok: false, error: 'unreadable_input', detail: err.message }) + '\n');
    return exit(2);
  }
  const domain = args.domain && args.domain.length > 0 ? args.domain : null;
  const inputFormat = args.inputFormat === 'manual_list' ? 'manual_list' : 'json_sample';
  let result;
  try {
    result = redact(raw, { domain, inputFormat });
  } catch (err) {
    // High-confidence secret triggers AbortError — surface as critical
    // so SKILL.md Phase 1 emits ⚠️ Need Human without ever writing a
    // partially-masked result file.
    stdout.write(JSON.stringify({
      ok: false,
      error: err.name === 'AbortError' ? 'high_confidence_secret' : 'redact_failed',
      detail: err.message,
    }) + '\n');
    return exit(2);
  }
  // Serialize Set → Array so the file can round-trip through JSON.
  const serialized = {
    maskedText: result.maskedText,
    forbiddenFingerprints: [...result.fingerprints],
    fieldDecisions: result.fieldDecisions,
    redactionSummary: result.summary,
  };
  try {
    fs.writeFileSync(args.output, JSON.stringify(serialized) + '\n', 'utf8');
  } catch (err) {
    stdout.write(JSON.stringify({ ok: false, error: 'write_failed', detail: err.message }) + '\n');
    return exit(2);
  }
  stdout.write(JSON.stringify({ ok: true, output: args.output, fingerprintCount: serialized.forbiddenFingerprints.length }) + '\n');
  return exit(0);
}

if (require.main === module) {
  runCli();
}
