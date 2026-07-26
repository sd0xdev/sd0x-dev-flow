'use strict';

/**
 * A `--require` preload that makes `fs.readdirSync` return entries in DESCENDING name order.
 *
 * The determinism tests it serves assert that `analyze.js` sorts what it enumerates. They used to
 * establish that by CREATING the fixture files in reverse order and trusting the filesystem to hand
 * them back the same way — which is not a property any filesystem promises. APFS returns directory
 * entries in hash order, ext4 in htree order; on either, the "reverse" fixture can come back already
 * ascending and an implementation with no `.sort()` at all passes. The tests were then asserting
 * something about the machine they ran on, not about the code.
 *
 * Preloading this removes the filesystem from the question entirely: whatever order the kernel
 * would have produced, the script under test sees the WORST one for it — exactly reversed from the
 * answer it must give. An unsorted implementation cannot be accidentally right.
 *
 * Descending order is applied with the same comparison `.sort()` uses by default (code-unit
 * ordering, not locale collation), so the adversary is the exact inverse of the fix rather than an
 * approximation of it.
 *
 * Deliberately narrow: only `readdirSync`, and only the array it returns. `analyze.js` uses no other
 * enumeration API, and patching ones nothing calls would put untested code in a test helper.
 */

const fs = require('node:fs');

const realReaddirSync = fs.readdirSync;

// Where the interception is RECORDED: one `<directory>\t<file:line:col>` row per intercepted call.
// Proving the patch works in a probe process says nothing about whether the script under test went
// through it: a refactor to `fs.promises.readdir`, `opendirSync`, or a `readdirSync` captured before
// this preload ran would bypass the patch entirely, and the determinism tests would quietly go back
// to asserting whatever the filesystem returned. Only a log written by the ACTUAL analyze child can
// rule that out.
//
// The call site is recorded alongside the directory because the directory alone is presence, not
// attribution, and for `requests/` the two come apart: analyze.js enumerates that directory from two
// separate heuristics, so a test pinning the order-sensitive one was equally satisfied by the other
// — including in the very scenario this log exists to exclude.
const auditPath = process.env.READDIR_DESCENDING_AUDIT || '';

/**
 * The caller's `file:line`, taken from the first stack frame outside this helper.
 *
 * The directory alone is not an identity. `analyze.js` enumerates the same `requests/` directory
 * from two different heuristics, so "some call read this directory" is satisfied by EITHER — and a
 * test meaning to pin the order-sensitive one would be satisfied by the other, including after the
 * order-sensitive one was refactored to an API this preload does not patch. Recording where the
 * call came from is what turns the audit from presence into attribution.
 */
function callSite() {
  const stack = (new Error().stack || '').split('\n').slice(1);
  for (const frame of stack) {
    if (frame.includes(__filename)) continue;
    const m = /\(?([^()\s]+:\d+:\d+)\)?$/.exec(frame.trim());
    if (m) return m[1];
  }
  return 'unknown';
}

function entryName(entry) {
  if (typeof entry === 'string') return entry;
  // `withFileTypes: true` yields Dirent objects; `encoding: 'buffer'` yields Buffers.
  if (entry && typeof entry.name === 'string') return entry.name;
  return String(entry);
}

fs.readdirSync = function readdirSyncDescending(...args) {
  const result = realReaddirSync.apply(this, args);
  if (auditPath) {
    // Appended, never buffered: the script calls `process.exit()`, so anything held until exit is
    // lost. Failures are swallowed — an audit that cannot be written must not change the behaviour
    // of the run it is observing.
    try { fs.appendFileSync(auditPath, `${String(args[0])}\t${callSite()}\n`); } catch { /* observation only */ }
  }
  if (!Array.isArray(result)) return result;
  return result.slice().sort((a, b) => {
    const an = entryName(a);
    const bn = entryName(b);
    if (an === bn) return 0;
    return an < bn ? 1 : -1;
  });
};

module.exports = { realReaddirSync };
