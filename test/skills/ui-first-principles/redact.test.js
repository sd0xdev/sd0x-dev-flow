'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  redact,
  classifyField,
  classifyByValue,
  classifyByFieldName,
  isCryptoField,
  normalizeFieldName,
  PLACEHOLDER_RE,
} = require('../../../scripts/skills/ui-first-principles/redact');
const {
  AbortError,
  MEDIUM_CONFIDENCE_PATTERNS,
} = require('../../../scripts/security-redact');

// ---------- PhaseOneRedactResult shape ----------

test('redact: returns PhaseOneRedactResult shape for empty JSON object', () => {
  const r = redact('{}', { inputFormat: 'json_sample' });
  assert.equal(typeof r.maskedText, 'string');
  assert.ok(r.fingerprints instanceof Set);
  assert.ok(Array.isArray(r.fieldDecisions));
  assert.equal(typeof r.summary, 'object');
  assert.equal(r.summary.totalMasks, 0);
  assert.ok(Array.isArray(r.summary.maskedClasses));
  assert.equal(r.summary.cryptoAllowlistHits, 0);
  assert.equal(r.summary.baseRedactHits, 0);
});

test('redact: JSON parse failure falls back to string mode, still returns full shape', () => {
  const bad = '{email: user@e.com}'; // invalid JSON (unquoted key)
  const r = redact(bad, { inputFormat: 'json_sample' });
  assert.equal(typeof r.maskedText, 'string');
  assert.ok(r.fingerprints instanceof Set);
  // Email value should still be masked via fallback regex
  assert.ok(r.maskedText.includes('<redacted:email>'));
  assert.equal(r.summary.totalMasks, 1);
});

// ---------- PII class: email (value-pattern) ----------

test('redact: masks email in value pattern', () => {
  const input = JSON.stringify({ contact: 'user@example.com' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).contact, '<redacted:email>');
  assert.ok(r.summary.maskedClasses.includes('email'));
  assert.equal(r.summary.totalMasks, 1);
});

test('redact: masks email inside longer text (whole value replaced)', () => {
  const input = JSON.stringify({ note: 'Reach me at alice@co.com please' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).note, '<redacted:email>');
});

test('redact: multiple emails in array produce multiple fingerprints', () => {
  const input = JSON.stringify({ emails: ['a@b.com', 'c@d.com'] });
  const r = redact(input, { inputFormat: 'json_sample' });
  const arr = JSON.parse(r.maskedText).emails;
  assert.deepEqual(arr, ['<redacted:email>', '<redacted:email>']);
  assert.equal(r.summary.totalMasks, 2);
  assert.equal(r.fingerprints.size, 2);
});

// ---------- PII class: phone ----------

test('redact: field name phone triggers phone class', () => {
  const input = JSON.stringify({ phone: '0912-345-678' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).phone, '<redacted:phone>');
});

test('redact: field name mobile triggers phone class', () => {
  const input = JSON.stringify({ mobile: '0912345678' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).mobile, '<redacted:phone>');
});

test('redact: E.164 value triggers phone class even without matching field', () => {
  const input = JSON.stringify({ contact: '+886912345678' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).contact, '<redacted:phone>');
});

// ---------- PII class: address (v1 field-name only) ----------

test('redact: field name address triggers address class', () => {
  const input = JSON.stringify({ address: '台北市信義區松仁路 100 號' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).address, '<redacted:address>');
});

test('redact: field name street triggers address class', () => {
  const input = JSON.stringify({ street: 'Main St 42' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).street, '<redacted:address>');
});

test('redact: field name city triggers address class', () => {
  const input = JSON.stringify({ city: 'Taipei' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).city, '<redacted:address>');
});

// ---------- PII class: account_id ----------

test('redact: field name account triggers account_id class', () => {
  const input = JSON.stringify({ account: 'ACC-12345' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).account, '<redacted:account_id>');
});

test('redact: field name user_id triggers account_id class', () => {
  const input = JSON.stringify({ user_id: 'u_123' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).user_id, '<redacted:account_id>');
});

test('redact: field name customer_id triggers account_id class', () => {
  const input = JSON.stringify({ customer_id: 'c_456' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).customer_id, '<redacted:account_id>');
});

// ---------- PII class: national_id ----------

test('redact: Taiwan ID pattern triggers national_id', () => {
  const input = JSON.stringify({ id: 'A123456789' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).id, '<redacted:national_id>');
});

test('redact: US SSN pattern triggers national_id', () => {
  const input = JSON.stringify({ ssn: '123-45-6789' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).ssn, '<redacted:national_id>');
});

// ---------- Crypto allowlist (opt-in, fail-safe) ----------

test('crypto allowlist: domain=crypto + "from" field + 0x40-hex → kept', () => {
  const addr = '0x' + 'a'.repeat(40);
  const input = JSON.stringify({ from: addr });
  const r = redact(input, { inputFormat: 'json_sample', domain: 'crypto' });
  assert.equal(JSON.parse(r.maskedText).from, addr);
  assert.equal(r.summary.cryptoAllowlistHits, 1);
});

test('crypto allowlist: domain=crypto + "txHash" field + 0x64-hex → kept', () => {
  const h = '0x' + 'b'.repeat(64);
  const input = JSON.stringify({ txHash: h });
  const r = redact(input, { inputFormat: 'json_sample', domain: 'crypto' });
  assert.equal(JSON.parse(r.maskedText).txHash, h);
  assert.equal(r.summary.cryptoAllowlistHits, 1);
});

test('crypto allowlist: domain=crypto + tokenId field → kept', () => {
  const input = JSON.stringify({ tokenId: '12345' });
  const r = redact(input, { inputFormat: 'json_sample', domain: 'crypto' });
  assert.equal(JSON.parse(r.maskedText).tokenId, '12345');
  assert.equal(r.summary.cryptoAllowlistHits, 1);
});

test('crypto allowlist fail-safe: without domain flag, 0x address in "from" passes through (no PII match)', () => {
  // "from" is not a PII field name; 0x40-hex is excluded from base long-hex.
  // Without crypto opt-in, classifyField returns null → no mask, no allowlist hit.
  const addr = '0x' + 'a'.repeat(40);
  const input = JSON.stringify({ from: addr });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).from, addr);
  assert.equal(r.summary.cryptoAllowlistHits, 0);
});

test('crypto allowlist fail-safe: domain=crypto + non-crypto field name → NOT allowlisted', () => {
  // "random" field doesn't match crypto field whitelist.
  // Value passes classifyField (no PII match) → kept, but cryptoAllowlistHits stays 0.
  const addr = '0x' + 'a'.repeat(40);
  const input = JSON.stringify({ random: addr });
  const r = redact(input, { inputFormat: 'json_sample', domain: 'crypto' });
  assert.equal(r.summary.cryptoAllowlistHits, 0);
});

test('crypto allowlist does NOT bypass email/PII classes', () => {
  const input = JSON.stringify({
    from: '0x' + 'a'.repeat(40),
    email: 'u@e.com',
    customer_id: 'C-001',
  });
  const r = redact(input, { inputFormat: 'json_sample', domain: 'crypto' });
  const parsed = JSON.parse(r.maskedText);
  assert.equal(parsed.from, '0x' + 'a'.repeat(40)); // crypto allow
  assert.equal(parsed.email, '<redacted:email>');
  assert.equal(parsed.customer_id, '<redacted:account_id>');
  assert.equal(r.summary.cryptoAllowlistHits, 1);
  assert.equal(r.summary.totalMasks, 2);
});

// ---------- Fingerprint production ----------

test('fingerprint: SHA-256 prefix format', () => {
  const input = JSON.stringify({ email: 'user@example.com' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(r.fingerprints.size, 1);
  const [fp] = [...r.fingerprints];
  assert.match(fp, /^sha256:[0-9a-f]{12}$/);
});

test('fingerprint: deterministic for identical input', () => {
  const input = JSON.stringify({ email: 'x@y.com' });
  const r1 = redact(input, { inputFormat: 'json_sample' });
  const r2 = redact(input, { inputFormat: 'json_sample' });
  assert.deepEqual([...r1.fingerprints], [...r2.fingerprints]);
});

test('fingerprint: fieldDecisions record path + action + piiClass + fingerprint', () => {
  const input = JSON.stringify({ email: 'u@e.com', name: 'Alice' });
  const r = redact(input, { inputFormat: 'json_sample' });
  const emailDec = r.fieldDecisions.find(d => d.fieldName === 'email');
  const nameDec = r.fieldDecisions.find(d => d.fieldName === 'name');
  assert.equal(emailDec.action, 'mask');
  assert.equal(emailDec.piiClass, 'email');
  assert.match(emailDec.fingerprint, /^sha256:/);
  assert.equal(nameDec.action, 'keep');
  assert.equal(nameDec.piiClass, undefined);
});

// ---------- Placeholder short-circuit ----------

test('placeholder: pre-masked <redacted:email> is not re-processed', () => {
  const input = JSON.stringify({ email: '<redacted:email>' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(r.summary.totalMasks, 0);
  assert.equal(r.fingerprints.size, 0);
  assert.equal(JSON.parse(r.maskedText).email, '<redacted:email>');
});

test('placeholder: [REDACTED] marker is not re-processed', () => {
  const input = JSON.stringify({ api_secret: '[REDACTED]' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(r.summary.totalMasks, 0);
});

test('placeholder: PLACEHOLDER_RE regex matches both forms and rejects others', () => {
  assert.ok(PLACEHOLDER_RE.test('[REDACTED]'));
  assert.ok(PLACEHOLDER_RE.test('<redacted:email>'));
  assert.ok(PLACEHOLDER_RE.test('<redacted:national_id>'));
  assert.equal(PLACEHOLDER_RE.test('<redacted:EMAIL>'), false); // uppercase not allowed
  assert.equal(PLACEHOLDER_RE.test('text [REDACTED] more'), false);
});

// ---------- Base AbortError propagation ----------

test('AbortError: propagates when raw text contains AWS access key', () => {
  const aws = 'AKIA' + 'Z'.repeat(16);
  const input = JSON.stringify({ config: aws });
  assert.throws(
    () => redact(input, { inputFormat: 'json_sample' }),
    (err) => err instanceof AbortError,
  );
});

test('AbortError: propagates for GitHub PAT', () => {
  const ghp = 'ghp_' + 'a'.repeat(36);
  const input = JSON.stringify({ token: ghp });
  assert.throws(
    () => redact(input, { inputFormat: 'json_sample' }),
    (err) => err.name === 'AbortError',
  );
});

// ---------- Base-layer fingerprint pre-collection ----------

test('base-layer: password assignment in manual text pre-collects fingerprint', () => {
  const raw = 'password=foo123_sec';
  const r = redact(raw, { inputFormat: 'manual_list' });
  assert.ok(r.summary.baseRedactHits >= 1, 'expected baseRedactHits ≥ 1');
  assert.ok(r.fingerprints.size >= 1, 'expected ≥ 1 fingerprint from base pre-collection');
  // Base masks the value to [REDACTED]
  assert.ok(r.maskedText.includes('[REDACTED]'));
});

test('base-layer: long hex string in raw text pre-collects fingerprint', () => {
  const hex = 'a'.repeat(64); // 64-char hex, caught by base medium "long hex"
  const raw = `hash: ${hex}`;
  const r = redact(raw, { inputFormat: 'manual_list' });
  assert.ok(r.summary.baseRedactHits >= 1);
  assert.ok(r.fingerprints.size >= 1);
});

test('base-layer: fingerprint dedup — same value caught by multiple patterns counted once', () => {
  // Craft a string that could match multiple MEDIUM patterns on the same value.
  // `token=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef` — 40 char matches "long hex" via value
  // but 40-char is excluded from long-hex (git SHA exclusion); 64-char would trigger both
  // token assignment + long hex. Verify only one baseRedactHit per unique fingerprint.
  const val = 'a'.repeat(64);
  const raw = `token=${val}`;
  const r = redact(raw, { inputFormat: 'manual_list' });
  // token assignment captures group=2 (the value = val); long hex captures same val.
  // After dedup by fingerprint: baseRedactHits should be 1.
  assert.equal(r.summary.baseRedactHits, 1);
  assert.equal(r.fingerprints.size, 1);
});

// ---------- Nested structure walking ----------

test('walk: masks email nested inside object and array', () => {
  const input = JSON.stringify({
    user: { email: 'u@e.com', name: 'Alice' },
    transactions: [{ counterparty: 'b@c.com' }],
  });
  const r = redact(input, { inputFormat: 'json_sample' });
  const parsed = JSON.parse(r.maskedText);
  assert.equal(parsed.user.email, '<redacted:email>');
  assert.equal(parsed.user.name, 'Alice');
  assert.equal(parsed.transactions[0].counterparty, '<redacted:email>');
  assert.equal(r.summary.totalMasks, 2);
});

test('walk: preserves non-string primitives (number, boolean, null)', () => {
  const input = JSON.stringify({ amount: 100, active: true, deleted: null, email: 'u@e.com' });
  const r = redact(input, { inputFormat: 'json_sample' });
  const parsed = JSON.parse(r.maskedText);
  assert.equal(parsed.amount, 100);
  assert.equal(parsed.active, true);
  assert.equal(parsed.deleted, null);
  assert.equal(parsed.email, '<redacted:email>');
});

test('walk: fieldDecisions include nested path', () => {
  const input = JSON.stringify({ user: { email: 'u@e.com' } });
  const r = redact(input, { inputFormat: 'json_sample' });
  const dec = r.fieldDecisions.find(d => d.action === 'mask');
  assert.equal(dec.path, 'user.email');
  assert.equal(dec.fieldName, 'email');
});

// ---------- classifyField unit-level ----------

test('classifyField: null for empty / non-string', () => {
  assert.equal(classifyField('foo', ''), null);
  assert.equal(classifyField('foo', 123), null);
  assert.equal(classifyField('foo', null), null);
});

test('classifyField: email takes precedence over field name', () => {
  assert.equal(classifyField('note', 'foo@bar.com'), 'email');
});

test('classifyField: returns null for plain text', () => {
  assert.equal(classifyField('description', 'Hello world'), null);
});

// ---------- isCryptoField unit-level ----------

test('isCryptoField: ETH address with "from" field → true', () => {
  assert.equal(isCryptoField('from', '0x' + 'a'.repeat(40)), true);
});

test('isCryptoField: ETH address with non-crypto field → false', () => {
  assert.equal(isCryptoField('random', '0x' + 'a'.repeat(40)), false);
});

test('isCryptoField: 40-hex without 0x prefix → false', () => {
  assert.equal(isCryptoField('from', 'a'.repeat(40)), false);
});

test('isCryptoField: tokenId field always true (regardless of value pattern)', () => {
  assert.equal(isCryptoField('tokenId', '123'), true);
  assert.equal(isCryptoField('token_id', '123'), true);
});

// ---------- PII class: credential (JSON form leak closure) ----------
// Rewritten 2026-09-05. These five originally asserted `<redacted:credential>` for every field,
// written when the base layer's quote-boundary bug meant it never caught a quoted JSON key — so
// the structural classifier (classifyByFieldName) was always the one that fired, uncontested. That
// bug was fixed 2026-09-04 (the base layer now catches `{"password":"…"}` etc. directly), which
// means these five fields are now caught by the BASE layer first for every keyword the base
// patterns name (password/passwd/pwd/token/api_key/secret/credential — substring, no `\b`, so
// `accessToken` and `apiKey` both qualify). The pre-existing, deliberate design for a base-caught
// value is cooperative short-circuit — return `[REDACTED]` unchanged, no re-classification — proven
// by the older test right below this block ("fallback: base redact catches apiKey, credential class
// does not double-mask"). `privateKey` names none of the base keywords, so it is the one field here
// still classified structurally, and is the test that proves the credential class still works when
// nothing upstream has already caught it.

test('credential: password field in JSON is caught by the base layer, cooperatively', () => {
  const input = JSON.stringify({ password: 'foo123_sec' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).password, '[REDACTED]');
  assert.doesNotMatch(r.maskedText, /foo123_sec/);
  assert.equal(r.summary.maskedClasses.includes('credential'), false,
    'a base-caught value is not double-masked into a PII class');
});

test('credential: secret field in JSON is caught by the base layer, cooperatively', () => {
  const input = JSON.stringify({ secret: 'shh_dont_tell' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).secret, '[REDACTED]');
  assert.doesNotMatch(r.maskedText, /shh_dont_tell/);
});

test('credential: apiKey (camelCase) field in JSON is caught by the base layer', () => {
  const input = JSON.stringify({ apiKey: 'ak_live_xxxxx' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).apiKey, '[REDACTED]');
  assert.doesNotMatch(r.maskedText, /ak_live_xxxxx/);
});

test('credential: api_key (snake_case) field in JSON is caught by the base layer', () => {
  const input = JSON.stringify({ api_key: 'ak_live_xxxxx' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).api_key, '[REDACTED]');
  assert.doesNotMatch(r.maskedText, /ak_live_xxxxx/);
});

test('credential: accessToken and token are base-caught; privateKey is not and stays structural', () => {
  const input = JSON.stringify({
    accessToken: 'atok_123',
    privateKey: 'pk_xyz',
    token: 'bearer_abc',
  });
  const r = redact(input, { inputFormat: 'json_sample' });
  const parsed = JSON.parse(r.maskedText);
  // `accessToken` and `token` both name the base keyword `token` as a substring — base-caught.
  assert.equal(parsed.accessToken, '[REDACTED]');
  assert.equal(parsed.token, '[REDACTED]');
  // `privateKey` names no base keyword (password/passwd/pwd/token/api_key/secret/credential), so
  // only the structural field-name classifier catches it, and it alone earns the PII class.
  assert.equal(parsed.privateKey, '<redacted:credential>');
  assert.ok(r.summary.maskedClasses.includes('credential'),
    'the class is reported for the one field the base layer never touched');
  for (const raw of ['atok_123', 'pk_xyz', 'bearer_abc']) {
    assert.doesNotMatch(r.maskedText, new RegExp(raw), `${raw} must not survive`);
  }
});

// ---------- Crypto allowlist vs explicit value PII (priority reorder) ----------

test('priority: tokenId with email value is masked as email (NOT crypto_allow)', () => {
  const input = JSON.stringify({ tokenId: 'alice@example.com' });
  const r = redact(input, { inputFormat: 'json_sample', domain: 'crypto' });
  assert.equal(JSON.parse(r.maskedText).tokenId, '<redacted:email>');
  assert.equal(r.summary.cryptoAllowlistHits, 0);
});

test('priority: tokenId with SSN value is masked as national_id (NOT crypto_allow)', () => {
  const input = JSON.stringify({ tokenId: '123-45-6789' });
  const r = redact(input, { inputFormat: 'json_sample', domain: 'crypto' });
  assert.equal(JSON.parse(r.maskedText).tokenId, '<redacted:national_id>');
  assert.equal(r.summary.cryptoAllowlistHits, 0);
});

test('priority: tokenId with numeric value (no PII) is crypto_allow', () => {
  const input = JSON.stringify({ tokenId: '12345' });
  const r = redact(input, { inputFormat: 'json_sample', domain: 'crypto' });
  assert.equal(JSON.parse(r.maskedText).tokenId, '12345');
  assert.equal(r.summary.cryptoAllowlistHits, 1);
});

// ---------- Field-name token boundaries (no substring false positives) ----------

test('classifyByFieldName: ipaddress does NOT match address PII', () => {
  assert.equal(classifyByFieldName('ipaddress'), null);
});

test('classifyByFieldName: ipAddress (camelCase) normalizes to ip_address → matches address', () => {
  // Over-mask is safer than under-mask; camelCase boundary makes this explicit.
  assert.equal(classifyByFieldName('ipAddress'), 'address');
});

test('classifyByFieldName: hotel does NOT match phone PII (tel substring)', () => {
  assert.equal(classifyByFieldName('hotel'), null);
});

test('classifyByFieldName: billingAddress → address', () => {
  assert.equal(classifyByFieldName('billingAddress'), 'address');
});

test('classifyByFieldName: customerId, memberId, userId all → account_id', () => {
  assert.equal(classifyByFieldName('customerId'), 'account_id');
  assert.equal(classifyByFieldName('memberId'), 'account_id');
  assert.equal(classifyByFieldName('userId'), 'account_id');
});

test('normalizeFieldName: camelCase → snake_case lowered', () => {
  assert.equal(normalizeFieldName('billingAddress'), 'billing_address');
  assert.equal(normalizeFieldName('apiKey'), 'api_key');
  assert.equal(normalizeFieldName('userID'), 'user_id');
  assert.equal(normalizeFieldName('already_snake'), 'already_snake');
});

// ---------- national_id third pattern (meet ≥3 per-class coverage) ----------

test('national_id: SSN in nested object is masked', () => {
  const input = JSON.stringify({ applicant: { ssn: '987-65-4321' } });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).applicant.ssn, '<redacted:national_id>');
});

// ---------- Shape on other exit paths (manual_list, empty, non-string) ----------

test('shape: manual_list input returns full PhaseOneRedactResult', () => {
  const r = redact('email: string (user contact)', { inputFormat: 'manual_list' });
  assert.equal(typeof r.maskedText, 'string');
  assert.ok(r.fingerprints instanceof Set);
  assert.ok(Array.isArray(r.fieldDecisions));
  assert.equal(typeof r.summary.totalMasks, 'number');
});

test('shape: empty string input returns full shape with zero counts', () => {
  const r = redact('', { inputFormat: 'json_sample' });
  assert.equal(typeof r.maskedText, 'string');
  assert.equal(r.summary.totalMasks, 0);
  assert.equal(r.summary.baseRedactHits, 0);
});

test('shape: non-string input returns full shape with empty maskedText', () => {
  const r = redact(null, { inputFormat: 'json_sample' });
  assert.equal(r.maskedText, '');
  assert.equal(r.fingerprints.size, 0);
});

// ---------- Nested edge cases ----------

test('walk: arrays of primitives — path is array[idx], classify by value still works', () => {
  const input = JSON.stringify({ emails: ['a@b.com'] });
  const r = redact(input, { inputFormat: 'json_sample' });
  const dec = r.fieldDecisions.find((d) => d.action === 'mask');
  assert.equal(dec.path, 'emails[0]');
  assert.equal(dec.fieldName, '0');
  assert.equal(dec.piiClass, 'email');
});

test('walk: deeply nested object preserves paths', () => {
  const input = JSON.stringify({ a: { b: { c: { email: 'deep@x.com' } } } });
  const r = redact(input, { inputFormat: 'json_sample' });
  const dec = r.fieldDecisions.find((d) => d.action === 'mask');
  assert.equal(dec.path, 'a.b.c.email');
});

test('walk: numeric value in account_id field is preserved (only strings are classified)', () => {
  // If the value is a number (not a string), we do not mask — documented behavior.
  const input = JSON.stringify({ user_id: 12345 });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(JSON.parse(r.maskedText).user_id, 12345);
  assert.equal(r.summary.totalMasks, 0);
});

// ---------- Defensive regex cloning (P1: stale lastIndex immunity) ----------

test('defense: matchAll ignores stale lastIndex on shared global regex', () => {
  // Simulate a shared stateful regex by mutating lastIndex on an exported MEDIUM pattern.
  // redact() must clone and reset so pre-collection is deterministic.
  const original = MEDIUM_CONFIDENCE_PATTERNS[0].re;
  const savedLastIndex = original.lastIndex;
  original.lastIndex = 9999;
  try {
    const r = redact('password=leaked_val', { inputFormat: 'manual_list' });
    assert.ok(r.summary.baseRedactHits >= 1, 'expected fingerprint collected despite stale lastIndex');
    assert.ok(r.fingerprints.size >= 1);
  } finally {
    original.lastIndex = savedLastIndex;
  }
});

// ---------- classifyByValue / composition ----------

test('classifyByValue: email is detected regardless of field name', () => {
  assert.equal(classifyByValue('x@y.com'), 'email');
});

test('classifyByValue: strict E.164 requires + prefix', () => {
  assert.equal(classifyByValue('+886912345678'), 'phone');
  assert.equal(classifyByValue('0912345678'), null); // no + → relies on field name
});

test('classifyField: composition returns classifyByValue first', () => {
  // When both value and field name could match, value wins (deterministic precedence).
  assert.equal(classifyField('address', 'hello@world.com'), 'email');
});

test('classifyField: composition falls back to field name when value is neutral', () => {
  assert.equal(classifyField('address', '台北市信義區'), 'address');
});

// ---------- Fallback whitespace regression (value trimmed before classify/fingerprint) ----------

test('fallback whitespace: SSN with trailing space is masked, fingerprint uses trimmed value', () => {
  // Simulates value captured by KV_RE with surrounding whitespace
  const r = redact('ssn: 123-45-6789 ,', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'));
  // Fingerprint must match sha256 of trimmed value, not raw with spaces
  const trimmedFp = 'sha256:' +
    require('node:crypto').createHash('sha256').update('123-45-6789').digest('hex').slice(0, 12);
  assert.ok(r.fingerprints.has(trimmedFp), 'fingerprint should be computed on trimmed value');
});

test('fallback whitespace: Taiwan national ID with trailing space still masked', () => {
  const r = redact('id: A123456789 ,', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'));
});

test('fallback whitespace: strict E.164 with surrounding space still masked', () => {
  const r = redact('contact: +886912345678 ,', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:phone>'));
});

test('fallback: camelCase credential field only caught by structure-aware (privateKey)', () => {
  // `apiKey` would be caught by base redact (case-insensitive `api[_-]?key`),
  // so we use `privateKey` which is NOT in base patterns — only the structure-aware
  // CREDENTIAL_FIELD_RE layer can catch it, proving the credential class works in fallback.
  const r = redact('privateKey: pk_live_abc', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:credential>'), r.maskedText);
});

test('fallback: base redact catches apiKey, credential class does not double-mask', () => {
  // Layered defense: base catches `apiKey` via its case-insensitive pattern and
  // writes `[REDACTED]`. Structure-aware sees the placeholder and short-circuits
  // (no <redacted:credential> wrapping) — correct cooperative behavior.
  const r = redact('apiKey: ak_live_xxx', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('[REDACTED]'));
  assert.equal(r.maskedText.includes('<redacted:credential>'), false);
  // But fingerprint WAS pre-collected for the original secret value
  assert.ok(r.summary.baseRedactHits >= 1);
});

test('fallback: JSON-parse failure path masks SSN via anchored regex (not just email)', () => {
  const bad = '{ssn: 987-65-4321}'; // unquoted JSON → falls back
  const r = redact(bad, { inputFormat: 'json_sample' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'));
});

test('KV_RE: comma still terminates values (no sibling over-capture)', () => {
  // Defense for the KV_RE `]` allowance — comma is still a terminator so `[1,2]` does not
  // swallow the next sibling.
  const r = redact('a=[1,2], email=leak@x.com', { inputFormat: 'manual_list' });
  // email should be classified as email (not swallowed into `a`'s value)
  assert.ok(r.maskedText.includes('<redacted:email>'));
});

test('CREDENTIAL_FIELD_RE: tokenizer / tokenize do NOT match credential (boundary safety)', () => {
  assert.equal(classifyByFieldName('tokenizer'), null);
  assert.equal(classifyByFieldName('tokenize'), null);
  // But refreshToken / bearerToken DO match
  assert.equal(classifyByFieldName('refreshToken'), 'credential');
  assert.equal(classifyByFieldName('bearerToken'), 'credential');
});

// ---------- Bracket-terminator fallback (KV_RE alternation) ----------

test('fallback bracket-term: SSN followed by trailing `]` is masked (not over-captured)', () => {
  const r = redact('ssn: 123-45-6789 ]', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
});

test('fallback bracket-term: Taiwan ID followed by trailing `]` is masked', () => {
  const r = redact('id: A123456789 ]', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
});

test('fallback bracket-term: strict E.164 followed by trailing `]` is masked', () => {
  const r = redact('contact: +886912345678 ]', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:phone>'), r.maskedText);
});

test('fallback alternation: [REDACTED] placeholder still captured whole (short-circuit preserved)', () => {
  // Regression test for KV_RE alternation — literal [REDACTED] goes through short-circuit
  const r = redact('password=[REDACTED]', { inputFormat: 'manual_list' });
  assert.equal(r.maskedText, 'password=[REDACTED]');
  assert.equal(r.summary.totalMasks, 0);
});

// ---------- JSON-mode whitespace (decideLeaf trim hardening) ----------

test('JSON whitespace: SSN with surrounding spaces is still masked (not leaked)', () => {
  const input = JSON.stringify({ ssn: ' 123-45-6789 ' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
  assert.equal(r.maskedText.includes('123-45-6789'), false);
});

test('JSON whitespace: Taiwan ID with surrounding spaces is still masked', () => {
  const input = JSON.stringify({ id: ' A123456789 ' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
  assert.equal(r.maskedText.includes('A123456789'), false);
});

test('JSON whitespace: strict E.164 phone with surrounding spaces is still masked', () => {
  const input = JSON.stringify({ contact: ' +886912345678 ' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.ok(r.maskedText.includes('<redacted:phone>'), r.maskedText);
  assert.equal(r.maskedText.includes('+886912345678'), false);
});

test('JSON whitespace + crypto domain: tokenId with whitespace-padded SSN is masked (value-PII wins over allowlist)', () => {
  // Regression for R4: before the trim() hoist in decideLeaf, anchored SSN_RE missed
  // the padded value and the field name `tokenId` triggered crypto_allow, leaking the SSN.
  const input = JSON.stringify({ tokenId: ' 123-45-6789 ' });
  const r = redact(input, { domain: 'crypto', inputFormat: 'json_sample' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
  assert.equal(r.maskedText.includes('123-45-6789'), false);
  assert.equal(r.summary.cryptoAllowlistHits, 0);
});

test('JSON whitespace + crypto domain: genuine tokenId with numeric value still allowlisted', () => {
  // Sanity check that trim() hoist did not regress legitimate crypto allowlist behavior.
  const input = JSON.stringify({ tokenId: '  42  ' });
  const r = redact(input, { domain: 'crypto', inputFormat: 'json_sample' });
  assert.equal(r.summary.cryptoAllowlistHits, 1);
  assert.equal(r.maskedText.includes('<redacted:'), false);
});

test('JSON whitespace: email with leading/trailing spaces is still masked', () => {
  const input = JSON.stringify({ contact: '  leak@example.com  ' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.ok(r.maskedText.includes('<redacted:email>'), r.maskedText);
});

test('crypto allowlist: empty / whitespace-only tokenId does NOT increment cryptoAllowlistHits', () => {
  // Regression for R5 P2 — empty / whitespace values are semantically meaningless
  // and must not pollute the summary.
  const input = JSON.stringify({ tokenId: '', txhash: '   ' });
  const r = redact(input, { domain: 'crypto', inputFormat: 'json_sample' });
  assert.equal(r.summary.cryptoAllowlistHits, 0);
});

test('crypto allowlist fallback mode: empty tokenId does NOT increment cryptoAllowlistHits', () => {
  const r = redact('tokenId=   ', { domain: 'crypto', inputFormat: 'manual_list' });
  assert.equal(r.summary.cryptoAllowlistHits, 0);
});

test('empty value: empty tokenId does NOT fall through to credential mask (no empty fingerprint)', () => {
  // Regression for R6 P2 — empty / whitespace trimmed values carry no PII and must
  // not pollute totalMasks / fingerprints with empty-string sha256 hashes.
  const input = JSON.stringify({ tokenId: '', password: '   ', note: 'hello' });
  const r = redact(input, { inputFormat: 'json_sample' });
  assert.equal(r.summary.totalMasks, 0);
  assert.equal(r.summary.maskedClasses.length, 0);
  // Empty fingerprint sha256 prefix that would have leaked had the guard been missing
  assert.equal(r.fingerprints.has('sha256:e3b0c44298fc'), false);
});

test('empty value fallback mode: empty credential does NOT fall through to mask', () => {
  const r = redact('password=   ,apiKey=', { inputFormat: 'manual_list' });
  assert.equal(r.summary.totalMasks, 0);
  assert.equal(r.summary.maskedClasses.length, 0);
});

// ---------- Multi-KV same-line (R8 P1: whitespace-exclusion in KV_RE) ----------

test('fallback multi-KV: ssn + id on same line are both masked (no leak via greedy capture)', () => {
  // R8 P1 regression — before excluding `\s` from KV_RE value class, the greedy
  // capture swallowed siblings and the trimmed oversized value failed anchored
  // SSN_RE / TAIWAN_ID_RE, leaking the PII verbatim.
  const r = redact('ssn=123-45-6789 id=A123456789', { inputFormat: 'manual_list' });
  assert.equal(r.summary.totalMasks, 2);
  assert.equal(r.maskedText.includes('123-45-6789'), false);
  assert.equal(r.maskedText.includes('A123456789'), false);
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
});

test('fallback multi-KV: phone + email on same line are both masked', () => {
  const r = redact('contact=+886912345678 email=a@b.co', { inputFormat: 'manual_list' });
  assert.equal(r.summary.totalMasks, 2);
  assert.ok(r.maskedText.includes('<redacted:phone>'), r.maskedText);
  assert.ok(r.maskedText.includes('<redacted:email>'), r.maskedText);
});

test('JSON parse failure fallback: multi-KV same line PII is still masked', () => {
  // Unquoted JSON falls back to string mode; the KV_RE whitespace fix must apply.
  const r = redact('{ssn=123-45-6789 id=A123456789}', { inputFormat: 'json_sample' });
  assert.equal(r.summary.totalMasks, 2);
  assert.equal(r.maskedText.includes('123-45-6789'), false);
  assert.equal(r.maskedText.includes('A123456789'), false);
});

test('fallback quoted value: internal whitespace still preserved (3-way alternation)', () => {
  // Quoted values use dedicated `"..."` / `'...'` branches that allow internal
  // whitespace, so `'keep this text'` stays intact while `a@b.co` (with no PII
  // pattern needed to match the whole value since EMAIL_RE is substring-tested)
  // is masked.
  const r = redact("note='keep this text' email='a@b.co'", { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes("note='keep this text'"), r.maskedText);
  assert.ok(r.maskedText.includes('<redacted:email>'), r.maskedText);
});

// ---------- Quoted whitespace-padded PII (R9 P1) ----------

test('fallback quoted SSN with whitespace padding is masked (not skipped by KV_RE)', () => {
  // R9 P1 regression — before the 3-way alternation, `ssn=' 123-45-6789 '` did
  // not match KV_RE at all (the unquoted branch excluded whitespace and no
  // dedicated quoted branch existed), so the PII leaked verbatim.
  const r = redact("ssn=' 123-45-6789 '", { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
  assert.equal(r.maskedText.includes('123-45-6789'), false);
});

test('fallback quoted Taiwan ID with whitespace padding is masked', () => {
  const r = redact("id=' A123456789 '", { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
});

test('fallback quoted strict E.164 with whitespace padding is masked', () => {
  const r = redact("contact=' +886912345678 '", { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:phone>'), r.maskedText);
});

test('fallback double-quoted SSN with whitespace padding is masked', () => {
  const r = redact('ssn=" 123-45-6789 "', { inputFormat: 'manual_list' });
  assert.ok(r.maskedText.includes('<redacted:national_id>'), r.maskedText);
});

test('JSON-parse fallback: quoted whitespace-padded SSN and bare ID both masked on same line', () => {
  const r = redact("{ssn=' 123-45-6789 ' id=A123456789}", { inputFormat: 'json_sample' });
  assert.equal(r.summary.totalMasks, 2);
  assert.equal(r.maskedText.includes('123-45-6789'), false);
  assert.equal(r.maskedText.includes('A123456789'), false);
});

// ---------- Crypto hash field anchor: `tx` exact-only, not prefix (R9 P2) ----------

test('isCryptoField: txNonce / txType do NOT allowlist (tx is exact-only, not a prefix)', () => {
  const ethHash = '0x' + 'a'.repeat(64);
  assert.equal(isCryptoField('txNonce', ethHash), false);
  assert.equal(isCryptoField('txType', ethHash), false);
  assert.equal(isCryptoField('txData', ethHash), false);
});

test('isCryptoField: legitimate tx* hash fields still allowlisted via hash/txhash tokens', () => {
  const ethHash = '0x' + 'a'.repeat(64);
  assert.equal(isCryptoField('txHash', ethHash), true);
  assert.equal(isCryptoField('transactionHash', ethHash), true);
  assert.equal(isCryptoField('blockHash', ethHash), true);
  assert.equal(isCryptoField('tx', ethHash), true, 'exact `tx` field still allowlisted');
});

// ---------- Crypto allowlist token anchoring (R8 P2) ----------

test('isCryptoField: substring FPs rejected (ipaddress / emailaddress / subcontract / homeowner)', () => {
  // R8 P2 regression — previously unanchored `address` / `contract` / `owner` etc.
  // matched arbitrary substrings in field names, enabling the crypto allowlist to
  // bypass field-name PII classification inconsistently with the documented
  // token-boundary hardening of the field-name PII layer.
  const ethAddr = '0x' + 'a'.repeat(40);
  assert.equal(isCryptoField('ipaddress', ethAddr), false);
  assert.equal(isCryptoField('emailaddress', ethAddr), false);
  assert.equal(isCryptoField('subcontract', ethAddr), false);
  assert.equal(isCryptoField('homeowner', ethAddr), false);
});

test('isCryptoField: legitimate crypto fields still allowlisted (from / contractAddress / txHash / tokenId)', () => {
  // Sanity check that token anchoring did not regress real crypto field handling.
  const ethAddr = '0x' + 'a'.repeat(40);
  const ethHash = '0x' + 'a'.repeat(64);
  assert.equal(isCryptoField('from', ethAddr), true);
  assert.equal(isCryptoField('to', ethAddr), true);
  assert.equal(isCryptoField('contractAddress', ethAddr), true);
  assert.equal(isCryptoField('txHash', ethHash), true);
  assert.equal(isCryptoField('blockHash', ethHash), true);
  assert.equal(isCryptoField('tokenId', '42'), true);
});

test('crypto allowlist E2E: ipaddress field with ETH-addr-looking value is NOT bypassed by crypto domain', () => {
  // Before the anchoring fix, `domain=crypto` on `{ipaddress: "0x..."}` silently
  // allowlisted the value. With anchoring, `ipaddress` no longer matches
  // CRYPTO_ADDR_FIELD_RE, and since the field-name PII layer also rejects
  // `ipaddress` (not `ip_address`), the value stays as-is (non-PII format).
  const input = JSON.stringify({ ipaddress: '0x' + 'a'.repeat(40) });
  const r = redact(input, { domain: 'crypto', inputFormat: 'json_sample' });
  assert.equal(r.summary.cryptoAllowlistHits, 0);
});

test('layered cooperation: base layer may pre-collect whitespace-separated sequences (documented cross-layer behavior)', () => {
  // R7 P2 documentation — the base layer (scripts/security-redact.js) may greedily
  // match `key=value` patterns across whitespace separators (e.g., `password=   ,apiKey=`),
  // counting them in `baseRedactHits`. The structure-aware layer correctly treats each
  // individual empty value as `keep` (totalMasks=0), so there is no user-visible leak.
  // This test documents that `baseRedactHits` and the structure-aware `totalMasks` live
  // in separate accounting tracks by design. Any change to base-layer tokenization is
  // out of T1 scope and must be addressed in scripts/security-redact.js.
  const r = redact('password=   ,apiKey=', { inputFormat: 'manual_list' });
  // Structure-aware layer: no PII masked
  assert.equal(r.summary.totalMasks, 0);
  // Base layer: accounting is independent — may or may not record a hit, but that value
  // never becomes visible PII in the output. We only assert the user-visible contract.
  assert.equal(r.maskedText.includes('<redacted:'), false);
});
