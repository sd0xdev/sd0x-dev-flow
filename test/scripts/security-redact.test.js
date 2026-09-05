'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  redact,
  scanHighConfidence,
  maskMediumConfidence,
  AbortError,
} = require('../../scripts/security-redact');

// ---------------------------------------------------------------------------
// High-confidence: abort path
// ---------------------------------------------------------------------------

test('redact throws AbortError on RSA private key header', () => {
  const input = 'config line\n-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';
  assert.throws(() => redact(input), AbortError);
});

test('redact throws AbortError on AWS access key', () => {
  const input = 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
  assert.throws(() => redact(input), AbortError);
});

test('redact throws AbortError on OpenAI-style sk- token', () => {
  const input = 'const key = "sk-proj-abcdef1234567890ghijklmn"';
  assert.throws(() => redact(input), AbortError);
});

test('redact throws AbortError on GitHub PAT', () => {
  const input = 'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
  assert.throws(() => redact(input), AbortError);
});

test('redact throws AbortError on GitHub fine-grained PAT', () => {
  const input = 'GH_TOKEN=github_pat_11ABCDEFG1234567890abcdef';
  assert.throws(() => redact(input), AbortError);
});

test('redact throws AbortError on Google API key', () => {
  const input = 'GOOGLE_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz0123456';
  assert.throws(() => redact(input), AbortError);
});

test('abort error includes pattern name for diagnostics', () => {
  try {
    redact('-----BEGIN PRIVATE KEY-----\nXXX\n-----END PRIVATE KEY-----');
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.name, 'AbortError');
    assert.match(err.message, /High-confidence secret detected/);
    assert.ok(err.pattern);
    assert.equal(err.pattern.name, 'RSA private key');
  }
});

// ---------------------------------------------------------------------------
// Medium-confidence: mask path
// ---------------------------------------------------------------------------

test('redact masks password assignment with [REDACTED]', () => {
  const input = 'password=hunter2';
  const out = redact(input);
  assert.equal(out, 'password=[REDACTED]');
});

test('redact masks token assignment preserving surrounding format', () => {
  const input = 'token: "abc123def456"';
  const out = redact(input);
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /abc123def456/);
});

test('redact masks long hex strings (>=32 chars)', () => {
  const input = 'sha: a1b2c3d4e5f67890a1b2c3d4e5f67890';
  const out = redact(input);
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /a1b2c3d4e5f67890a1b2c3d4e5f67890/);
});

test('redact masks JWT-like strings', () => {
  const input = 'Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij';
  const out = redact(input);
  assert.match(out, /\[REDACTED\]/);
});

test('redact preserves non-secret content intact', () => {
  const input = 'function foo() { return 42; }';
  const out = redact(input);
  assert.equal(out, input);
});

test('redact handles empty input gracefully', () => {
  assert.equal(redact(''), '');
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
});

// ---------------------------------------------------------------------------
// Component helpers
// ---------------------------------------------------------------------------

test('scanHighConfidence returns null when no match', () => {
  assert.equal(scanHighConfidence('hello world'), null);
});

test('scanHighConfidence returns name + opaque fingerprint on match', () => {
  const hit = scanHighConfidence('AKIAIOSFODNN7EXAMPLE');
  assert.ok(hit);
  assert.equal(hit.name, 'AWS access key');
  assert.match(hit.fingerprint, /^sha256:[a-f0-9]{8}$/);
  // Fingerprint must not reveal the actual secret
  assert.doesNotMatch(hit.fingerprint, /AKIA/);
});

test('abort error message does not leak secret prefix or suffix', () => {
  try {
    redact('AKIAIOSFODNN7EXAMPLE');
    assert.fail('should have thrown');
  } catch (err) {
    assert.doesNotMatch(err.message, /AKIA/, 'message must not include secret prefix');
    assert.doesNotMatch(err.message, /EXAMPLE/, 'message must not include secret suffix');
    assert.match(err.message, /sha256:/, 'message should include opaque fingerprint');
  }
});

test('maskMediumConfidence does not throw on high-confidence patterns', () => {
  // mask path should never throw — only redact() does
  const input = 'AKIAIOSFODNN7EXAMPLE';
  const out = maskMediumConfidence(input);
  assert.equal(typeof out, 'string');
});

// ---------------------------------------------------------------------------
// Fallback mode: abortOnHigh=false
// ---------------------------------------------------------------------------

test('redact with abortOnHigh=false masks high-confidence instead of throwing', () => {
  const input = 'AKIAIOSFODNN7EXAMPLE and hunter2 password=secret';
  const out = redact(input, { abortOnHigh: false });
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /AKIAIOSFODNN7EXAMPLE/);
});

// ---------------------------------------------------------------------------
// Additional pattern coverage
// ---------------------------------------------------------------------------

test('redact throws AbortError on Slack xoxb- token', () => {
  const input = 'SLACK_BOT_TOKEN=xoxb-123456789-abcdefghijk';
  assert.throws(() => redact(input), AbortError);
});

test('hex boundary: 31 chars does not redact, 32 chars redacts', () => {
  const hex31 = 'a'.repeat(31);
  const hex32 = 'a'.repeat(32);
  assert.equal(redact(hex31), hex31, '31-char hex should pass through');
  const out = redact(hex32);
  assert.match(out, /\[REDACTED\]/, '32-char hex should redact');
});

test('40-char hex (git SHA-1) is preserved — not mistaken for a secret', () => {
  const gitSha = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4';
  assert.equal(gitSha.length, 40);
  const input = `Commit ${gitSha} deployed at 10:00`;
  assert.equal(redact(input), input, '40-char git SHA must survive redaction');
});

test('64-char hex (SHA-256) still redacted — not exempted', () => {
  const sha256Hex = 'a'.repeat(64);
  const out = redact(`digest=${sha256Hex}`);
  assert.match(out, /\[REDACTED\]/, '64-char hex should redact');
});

// Two credential shapes the medium-confidence patterns missed entirely until 2026-09-04, both
// routine in a real config file. Found when `/codex-implement` began printing created files through
// this module: the scan was the only thing between a Codex-written `credentials.json` and the
// transcript, and it left both of these untouched.
const MISSED = [
  ['{"token":"abcdefghijklmnop"}', 'abcdefghijklmnop', 'a quote sits between the key and the colon'],
  ['{"password":"hunter2extra"}', 'hunter2extra', 'same shape, password key'],
  ['API_TOKEN=abcdefghijklmnop', 'abcdefghijklmnop', '`\\btoken\\b` finds no boundary inside API_TOKEN'],
  ['DATABASE_PASSWORD=hunter2extra', 'hunter2extra', 'same, with an underscore-prefixed key'],
  ["client_secret: 'sk-not-a-real-one'", 'sk-not-a-real-one', 'prefixed secret with a quoted value'],
];
for (const [input, value, why] of MISSED) {
  test(`${input} — ${why}`, () => {
    const out = redact(input);
    assert.doesNotMatch(out, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the value must not survive');
    assert.match(out, /\[REDACTED\]/, 'and it is replaced rather than dropped');
  });
}

test('ordinary prose and identifiers containing the key words are left alone', () => {
  // The other direction, because a redactor that masks everything is unusable: these have no
  // assignment, so nothing is redacted.
  for (const clean of ['const tokenizer = makeTokenizer()', 'see docs/token.md',
    'the password policy is documented', 'secretive naming is a smell']) {
    assert.equal(redact(clean), clean, `${clean} must pass through unchanged`);
  }
});

// The value equal to, or a substring of, its own key. `match.replace(captured, …)` replaced the
// first equal substring anywhere in the match, so `{"password":"pass"}` came back as
// `{"[REDACTED]word":"pass"}` — key mangled, secret intact. Found by review 2026-09-04; the fix
// replaces by capture position, so these are the cases that pin it.
const VALUE_INSIDE_KEY = [
  ['{"password":"pass"}', 'password', 'pass'],
  ['API_TOKEN=TOKEN', 'API_TOKEN', 'TOKEN'],
  ['{"token":"tok"}', 'token', 'tok'],
  ['{"secret":"sec"}', 'secret', 'sec'],
];
for (const [input, key, value] of VALUE_INSIDE_KEY) {
  test(`${input} — the value is masked and the key survives intact`, () => {
    const out = redact(input);
    assert.match(out, new RegExp(key), 'the key must not be mangled');
    assert.match(out, /\[REDACTED\]/, 'the value is masked');
    assert.doesNotMatch(out, new RegExp(`["'=:]\\s*${value}\\b`),
      'and the value must not survive in value position');
  });
}

test('several assignments on one line are each masked at their own position', () => {
  const out = redact('a=1 password=p1 token=t2');
  assert.equal(out, 'a=1 password=[REDACTED] token=[REDACTED]',
    'positional replacement must not shift or drop the text between matches');
});

// P0, 2026-09-05: `VALUE` grew a `,;}` exclusion aimed at stopping a JSON value at the next key —
// the closing quote already did that job, so the exclusion was pure loss: a secret containing one
// of those three characters had its tail printed. A redactor must over-capture, never under-capture.
const TRUNCATION_REGRESSION = [
  ['password=p@ss;word', ';word'],
  ['pwd=a,b,c', ',b,c'],
  ['token=sk;live;xyz', ';live;xyz'],
];
for (const [input, mustNotSurvive] of TRUNCATION_REGRESSION) {
  test(`${input} — the whole value is masked, none of it survives after the mask`, () => {
    const out = redact(input);
    assert.doesNotMatch(out, new RegExp(mustNotSurvive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'a truncated exclusion set let the tail of the secret through');
    assert.match(out, /\[REDACTED\]$/, 'the whole value, to the end of the input, is masked');
  });
}

// P1, 2026-09-05: `\b[A-Za-z0-9_-]*` anchored a prefix scan before the keyword. `-` is not a word
// character, so every hyphen re-opened a boundary the star could restart from, and matching went
// quadratic — a 239 KB kebab-case or base64url input (its alphabet is exactly this class) took
// 40s / 4.5s against 0ms one line earlier in git history, with no length cap or timeout guarding the
// call site. Timed, not just re-derived: a regression here has to fail on wall-clock, or it is not
// proof the backtracking is gone.
test('a large kebab-case value does not cause quadratic backtracking', () => {
  const evil = 'a-'.repeat(120_000) + 'x';
  const start = Date.now();
  redact(`token=${evil}`);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `expected well under 1s, took ${elapsed}ms — the prefix-scan ReDoS is back`);
});

test('a large base64url value does not cause quadratic backtracking', () => {
  // base64url's alphabet is exactly [A-Za-z0-9_-], the class the old prefix scan restarted on.
  const evil = require('crypto').randomBytes(150_000).toString('base64url');
  const start = Date.now();
  redact(`secret=${evil}`);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `expected well under 1s, took ${elapsed}ms — the prefix-scan ReDoS is back`);
});
