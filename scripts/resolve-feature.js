#!/usr/bin/env node
'use strict';

/**
 * Resolver entrypoint. Wraps `resolve-feature-cli.js` and is the single owner of the failure
 * payload: exit 0 always, and on any failure emit the FULL shape with `scan_error: true` — never
 * `{}`. A `{}` reply carries no `scan_error`, so a consumer gating on `scan_error === true` sails
 * straight past it, and `result.current_authority.map(...)` is a TypeError besides. Consumers gate
 * on `scan_error !== false`.
 *
 * Usage: node scripts/resolve-feature.js [--feature <key>]
 *
 * Why Node rather than the shell shim, why the shape comes from a dependency-free module, why the
 * child is spawned and captured rather than `require`d or streamed, and why `maxBuffer` is set
 * explicitly: docs/features/doc-review-phasing/2-tech-spec.md § 3.2 (`scan_error`).
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { EMPTY_CONTEXT, isContextShape } = require('./lib/context-shape');

const CLI = path.join(__dirname, 'resolve-feature-cli.js');

/**
 * Explicit, and deliberately far above any real payload. `spawnSync` defaults to 1 MiB and
 * signals the overflow by killing the child with SIGTERM — so an undocumented ceiling would turn a
 * *successful* scan of a large feature into a `scan_error: true` the operator has no way to read as
 * "your corpus outgrew a constant". The largest feature in this repo serializes well under 100 KiB;
 * 32 MiB leaves two orders of magnitude of headroom while still bounding memory. Overflow remains
 * fail-closed — this raises the cliff and names it, it does not remove it.
 */
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;

function failurePayload() {
  return JSON.stringify({ ...EMPTY_CONTEXT(), scan_error: true });
}

function emitFailure() {
  process.stdout.write(`${failurePayload()}\n`);
}

function main() {
  const res = spawnSync(process.execPath, [CLI, ...process.argv.slice(2)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: MAX_STDOUT_BYTES,
  });

  // Any of: the process could not be spawned, it exited nonzero, it was killed by a signal (which
  // includes the SIGTERM `maxBuffer` overflow raises), or it wrote something that is not a single
  // JSON document. All of them mean the corpus was not enumerated, which is what `scan_error: true`
  // says.
  if (res.error || res.status !== 0 || typeof res.stdout !== 'string') {
    emitFailure();
    return;
  }

  // Parseable is not the same as usable. `7`, `[]`, `null` and `{"scan_error":false}` all parse,
  // and a consumer reading `payload.design_records.map(...)` out of any of them throws — the exact
  // TypeError the full-shape contract exists to prevent, arriving through the success path instead
  // of the failure one. Structure only: an empty corpus and a full one are both valid answers.
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    emitFailure();
    return;
  }
  if (!isContextShape(parsed)) {
    emitFailure();
    return;
  }
  process.stdout.write(res.stdout.endsWith('\n') ? res.stdout : `${res.stdout}\n`);
}

main();
