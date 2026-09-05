'use strict';

const crypto = require('crypto');

/**
 * security-redact.js — 2-tier secret redaction utility for post-dev-recap.
 *
 * Tiers:
 *   - high-confidence: well-known token prefixes and PEM private key markers
 *     → throws AbortError (callers stop processing)
 *   - medium-confidence: `password=`, `token:`, `api_key=`, long hex strings
 *     → replaced with `[REDACTED]`
 *
 * Used by: detect-scope.js, /recap-doc, /recap-ask
 * Tech spec: docs/features/post-dev-recap/2-tech-spec.md §3.4.0
 */

const HIGH_CONFIDENCE_PATTERNS = [
  { name: 'RSA private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'OpenAI-style API key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub PAT', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: 'Slack token', re: /\bxox[aboprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

// Two shapes these patterns used to miss entirely, both routine in a real credentials file (found
// by review 2026-09-04):
//   {"token":"abcdefghijklmnop"}   — a quote sits between the key and the `:`
//   API_TOKEN=abcdefghijklmnop     — `\btoken\b` finds no boundary inside `API_TOKEN`
// Two defects were then found and fixed in the fix itself (found by review 2026-09-05, both
// measured, both against the version this comment used to describe):
//   1. `VALUE` had grown a `,;}` exclusion, meant only to stop a JSON value at the next key — but
//      the closing quote already does that job, so the exclusion did nothing for JSON and instead
//      truncated any secret containing one of those three characters: `password=p@ss;word` redacted
//      to `password=[REDACTED];word`, four of `pwd=a,b,c`'s five secret characters survived. A
//      redactor must over-capture, never under-capture — reverted to whitespace/quote-only, which
//      is what this file had before either widening.
//   2. The key was matched by scanning a `[A-Za-z0-9_-]*` prefix anchored at `\b`. `-` is not a
//      word character, so every hyphen created a boundary the star could restart from, and the
//      pattern went quadratic: a 239 KB kebab-case or base64url input (its alphabet is exactly this
//      class) took 40s / 4.5s respectively against 0ms on the same input one line up in git history,
//      with no length cap or timeout guarding the call. The prefix scan is unnecessary: dropping the
//      `\b` anchor lets the keyword alternation match `TOKEN` directly inside `API_TOKEN` — no scan,
//      no backtracking, and the assignment separator immediately after is what already stops a false
//      match on ordinary prose ("secretive" is not followed by `[:=]`, so it never matches).
const SEP = "['\"`]?\\s*[:=]\\s*['\"`]?";
const VALUE = "([^\\s'\"`]+)";
const MEDIUM_CONFIDENCE_PATTERNS = [
  { name: 'password assignment',
    re: new RegExp(`(?:password|passwd|pwd)${SEP}${VALUE}`, 'gi'), group: 1 },
  { name: 'token assignment',
    re: new RegExp(`(?:token|api[_-]?key|secret|credential)${SEP}${VALUE}`, 'gi'), group: 1 },
  // 40-char hex is excluded (standard git SHA-1 length) to avoid redacting
  // commit SHAs cited in recap evidence. Still catches MD5 (32), SHA-256 (64),
  // and arbitrary longer tokens.
  { name: 'long hex string', re: /\b(?![a-f0-9]{40}\b)[a-f0-9]{32,}\b/gi },
  { name: 'JWT-like', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

class AbortError extends Error {
  constructor(message, pattern) {
    super(message);
    this.name = 'AbortError';
    this.pattern = pattern;
  }
}

/**
 * Scan text for high-confidence secrets. If any found, throw AbortError.
 * Returns the first match info for diagnostics (pattern name + match preview).
 */
function scanHighConfidence(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  for (const { name, re } of HIGH_CONFIDENCE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      return { name, fingerprint: fingerprint(m[0]) };
    }
  }
  return null;
}

/**
 * Apply medium-confidence redaction. Returns redacted text.
 */
function maskMediumConfidence(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const { re, group } of MEDIUM_CONFIDENCE_PATTERNS) {
    // Replace the captured group BY POSITION, using the `d` flag's match indices. The previous
    // implementation did `match.replace(captured, '[REDACTED]')`, which replaces the first equal
    // substring anywhere in the match — so when the value is also a substring of its own key the
    // key was mangled and the secret survived. Measured on the old code:
    //   {"password":"pass"} -> {"[REDACTED]word":"pass"}      (the secret is still there)
    //   API_TOKEN=TOKEN     -> API_[REDACTED]=TOKEN            (likewise)
    const base = re.flags.replace(/[gd]/g, '');
    const rx = new RegExp(re.source, base + 'gd');
    let result = '';
    let last = 0;
    for (const m of out.matchAll(rx)) {
      const span = typeof group === 'number' ? (m.indices && m.indices[group]) : [m.index, m.index + m[0].length];
      if (!span) continue;
      result += out.slice(last, span[0]) + '[REDACTED]';
      last = span[1];
    }
    out = result + out.slice(last);
  }
  return out;
}

/**
 * Full 2-tier redact: abort on high, mask on medium.
 * Callers should wrap in try/catch to handle AbortError.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.abortOnHigh=true] — if false, mask high-confidence instead of throwing
 * @returns {string}
 */
function redact(text, options = {}) {
  const { abortOnHigh = true } = options;
  if (typeof text !== 'string') return text;

  const high = scanHighConfidence(text);
  if (high) {
    if (abortOnHigh) {
      throw new AbortError(
        `High-confidence secret detected (${high.name}). Refusing to process. Fingerprint: ${high.fingerprint}`,
        high,
      );
    }
    // fallback: mask high-confidence patterns too
    let out = text;
    for (const { re } of HIGH_CONFIDENCE_PATTERNS) {
      out = out.replace(new RegExp(re, 'g'), '[REDACTED]');
    }
    return maskMediumConfidence(out);
  }

  return maskMediumConfidence(text);
}

/**
 * Opaque fingerprint for diagnostics — reveals neither prefix nor suffix of
 * the matched secret, so error logs do not leak partial tokens.
 */
function fingerprint(s) {
  if (!s) return '***';
  const hash = crypto.createHash('sha256').update(String(s)).digest('hex');
  return `sha256:${hash.slice(0, 8)}`;
}

module.exports = {
  redact,
  scanHighConfidence,
  maskMediumConfidence,
  AbortError,
  HIGH_CONFIDENCE_PATTERNS,
  MEDIUM_CONFIDENCE_PATTERNS,
};
