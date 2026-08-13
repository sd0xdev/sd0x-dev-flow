'use strict';

// MCP event-sourced dispatch lifecycle: immutable call-level dispatch records,
// lifecycle events folded by a pinned reducer, per-dispatch visibility
// decisions, the universal disposition writer, frontier records, and the
// single-settlement writer. Protocol, reducer table, and every rule's
// rationale: docs/features/auto-loop-evolution/2-tech-spec/
// 2-content-addressed-receipts.md §3.4 (WB3).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const receiptLog = require('./receipt-log');
const treeDigest = require('./tree-digest');

const EXPIRY_MS = 48 * 3600 * 1000; // exclusive boundary: at exactly 48h a record is already expired
const MCP_REVIEW_TOOLS = new Set(['mcp__codex__codex', 'mcp__codex__codex-reply']);
const REVIEW_PLANES = new Set(['code_review', 'doc_review']);
const EVENT_KINDS = new Set(['contested', 'owned', 'bound', 'ambiguous', 'expired', 'debt_cleared']);
const TERMINAL_STATES = new Set(['settled', 'contested', 'expired', 'ambiguous', 'poisoned']);

// ---------------------------------------------------------------------------
// Canonical request key — sha256 over the jq -cS form of tool_input: UTF-8,
// recursively sorted keys, no insignificant whitespace. Hooks receive
// tool_input re-serialized, never raw payload bytes, so the encoding is
// pinned by spec, not by whichever serializer printed it (§3.4).
// ---------------------------------------------------------------------------

function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

function requestKey(toolInput) {
  const obj = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
  return 'sha256:' + crypto.createHash('sha256').update(canonicalJson(obj), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Transcript identity and byte-range content proofs. File identity (device +
// inode + first-line hash) is a fast path only — inode reuse plus an identical
// first line can still collide — so every cross-time application of an offset
// also carries its own content proof: the recomputed prefix digest (§3.4).
// ---------------------------------------------------------------------------

function transcriptFileId(tPath) {
  const st = fs.statSync(tPath);
  const fd = fs.openSync(tPath, 'r');
  let firstLine;
  try {
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const slice = buf.subarray(0, Math.max(n, 0));
    const nl = slice.indexOf(0x0a);
    firstLine = nl === -1 ? slice : slice.subarray(0, nl);
  } finally {
    fs.closeSync(fd);
  }
  const h = crypto.createHash('sha256').update(firstLine).digest('hex').slice(0, 16);
  return `${st.dev}:${st.ino}:${h}`;
}

function prefixDigest(tPath, upto) {
  const fd = fs.openSync(tPath, 'r');
  try {
    if (fs.fstatSync(fd).size < upto) return null; // shorter file can never carry the prefix
    const hash = crypto.createHash('sha256');
    const buf = Buffer.alloc(1 << 20);
    let off = 0;
    while (off < upto) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, upto - off), off);
      if (n <= 0) return null;
      hash.update(buf.subarray(0, n));
      off += n;
    }
    return 'sha256:' + hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function rangeDigest(tPath, start, end) {
  const fd = fs.openSync(tPath, 'r');
  try {
    if (fs.fstatSync(fd).size < end) return null; // shorter file cannot carry the range
    const hash = crypto.createHash('sha256');
    const buf = Buffer.alloc(1 << 20);
    let off = start;
    while (off < end) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, end - off), off);
      if (n <= 0) return null;
      hash.update(buf.subarray(0, n));
      off += n;
    }
    return 'sha256:' + hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Recognition predicates — ported verbatim in intent from
// hooks/post-tool-review-state.sh (the per-namespace rules are unchanged by
// WB3; this file only relocates where they run). Request side proves what was
// ASKED; output side proves what came back; a verdict needs both (§3.4).
// ---------------------------------------------------------------------------

function requestAskedForCodeReview(inputText) {
  return inputText.includes('Merge Gate');
}

function requestAskedForDocReview(inputText) {
  return inputText.includes('Document Review');
}

function jsonFencedGates(text) {
  const gates = [];
  let inFence = false;
  for (const line of String(text).split('\n')) {
    if (/^[ \t]*```[jJ][sS][oO][nN][ \t]*$/.test(line)) {
      inFence = true;
      continue;
    }
    if (/^[ \t]*```[ \t]*$/.test(line)) {
      inFence = false;
      continue;
    }
    if (inFence) {
      const m = line.match(/"gate"[ \t]*:[ \t]*"(READY|BLOCKED)"/);
      if (m) gates.push(m[1]);
    }
  }
  return gates;
}

function outputIsDocReview(text) {
  return /^[ \t]*(#{2,4}[ \t]+|\*\*)Document Review([^A-Za-z0-9]|$)/m.test(text);
}

function outputIsCodeReview(text) {
  if (/^[ \t]*(#{2,4}[ \t]+|\*\*)Merge Gate([^A-Za-z0-9]|$)/m.test(text)) return true;
  return jsonFencedGates(text).length > 0;
}

// The background-handoff placeholder is NOT a completion: it is the harness
// saying the real report will arrive later as a task notification. Matched on
// the FIRST non-empty line (this repo's own issue-#10 write-ups quote both
// phrases inside fences, so substring matching would swallow real reports).
function outputIsBackgroundHandoff(text) {
  const first = String(text)
    .split('\n')
    .find(l => l.trim() !== '');
  if (!first) return false;
  return (
    /^MCP tool "[^"]*" is still running after/.test(first) &&
    text.includes('moved to the background as task')
  );
}

// BLOCKED-first (fail-closed): ambiguous output carrying both markers routes
// to fail, never to pass. Doc: no sentinel → null (no verdict to record).
function docReviewVerdict(text) {
  if (/⛔ Needs revision/.test(text)) return 'fail';
  if (/✅ Mergeable/.test(text)) return 'pass';
  return null;
}

// Code: recognized-but-sentinel-free returns null → the plane settles
// "no-verdict" (§3.4 round-8 algebra): an attempt record spends the identity
// but is never evidence, so it must not fabricate a FAIL that supersedes an
// older same-digest PASS. The gate stays open either way — no-verdict closes
// nothing — so this is not a fail-open relaxation of the hook's stricter
// "unreadable gate → false" stance; it only stops minting negative evidence.
function codeReviewVerdict(text) {
  const gates = jsonFencedGates(text);
  if (gates.includes('BLOCKED')) return 'fail';
  if (/⛔ Blocked/.test(text)) return 'fail';
  if (gates.includes('READY')) return 'pass';
  if (/✅ Ready/.test(text)) return 'pass';
  return null;
}

// ---------------------------------------------------------------------------
// Transcript scanner. Entries are the protocol's subject matter: an MCP
// review tool_use whose request side asks for at least one review plane.
// Results and task notifications are completion carriers. Offsets are byte
// offsets of the JSONL line (start inclusive, end = one past the newline);
// a trailing line without its newline is in-flight, never scanned.
// ---------------------------------------------------------------------------

function flattenResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n');
  }
  return '';
}

function scanTranscript(tPath, fromOffset = 0, opts = {}) {
  const st = fs.statSync(tPath);
  const size = st.size;
  const entries = [];
  const results = new Map(); // tooluseId -> {text, endOffset}
  const tasks = new Map(); // taskId -> {text, endOffset}
  // EVERY tool_use id in the scanned range, protocol or not (round 17):
  // tool_result attribution shares one id namespace with every tool, so a
  // non-review call reusing an id makes result attribution exactly as
  // undecidable as a protocol twin would — conflict accounting must count
  // what the result namespace can collide with, not only what this
  // protocol recognizes.
  const idCounts = new Map(); // tooluseId -> occurrence count
  const idMaxEnd = new Map(); // tooluseId -> max endOffset among ALL tool_use blocks
  if (size <= fromOffset) {
    const selfDigest = opts.selfDigest
      ? 'sha256:' + crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex')
      : null;
    return {
      size,
      parsedUpto: size,
      entries,
      results,
      tasks,
      idCounts,
      idMaxEnd,
      selfDigest,
      selfDigestUpto: fromOffset,
    };
  }
  const fd = fs.openSync(tPath, 'r');
  let buf;
  try {
    buf = Buffer.alloc(size - fromOffset);
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, fromOffset + off);
      if (n <= 0) break;
      off += n;
    }
    if (off < buf.length) buf = buf.subarray(0, off);
  } finally {
    fs.closeSync(fd);
  }
  // parsedUpto = one past the last fully-terminated line this scan consumed.
  // A torn tail's bytes stay AHEAD of it, so a cursor stored at parsedUpto
  // re-reads the line once its newline arrives — advancing to stat size would
  // strand the completing line's prefix forever (cursor advance rule, §3.4).
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break; // torn/in-flight tail — not an entry yet
    const startOffset = fromOffset + pos;
    const endOffset = fromOffset + nl + 1;
    const raw = buf.subarray(pos, nl + 1); // exact bytes [startOffset, endOffset)
    const line = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    // Parse-time digest of the raw line bytes, computed lazily ONCE per
    // line (round 12: a line carrying N protocol blocks must not be hashed
    // N times — the scan cost model is O(new bytes)).
    let lineDigest = null;
    const rawDigest = () => {
      if (lineDigest === null) {
        lineDigest = 'sha256:' + crypto.createHash('sha256').update(raw).digest('hex');
      }
      return lineDigest;
    };
    const content = obj.message && Array.isArray(obj.message.content) ? obj.message.content : null;
    if (content) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_use' && block.id) {
          const cid = String(block.id);
          idCounts.set(cid, (idCounts.get(cid) || 0) + 1);
          if (!idMaxEnd.has(cid) || idMaxEnd.get(cid) < endOffset) idMaxEnd.set(cid, endOffset);
        }
        if (block.type === 'tool_use' && MCP_REVIEW_TOOLS.has(block.name) && block.id) {
          let inputText;
          try {
            inputText = JSON.stringify(block.input);
          } catch {
            continue;
          }
          // A missing `input` serializes to undefined (not a string) — a
          // malformed block is skipped fail-closed, never allowed to wedge
          // every later scan of the same transcript.
          if (typeof inputText !== 'string') continue;
          const planes = [];
          if (requestAskedForCodeReview(inputText)) planes.push('code_review');
          if (requestAskedForDocReview(inputText)) planes.push('doc_review');
          if (planes.length === 0) continue; // not a protocol entry
          entries.push({
            tooluseId: String(block.id),
            key: requestKey(block.input),
            planes,
            startOffset,
            endOffset,
            // Digest of the SAME buffered bytes this entry was parsed from
            // (round 11): a digest recomputed later from the live path can
            // hash a rewrite's replacement bytes under this entry's parsed
            // metadata — the proof must be born with the parse.
            rangeDigest: rawDigest(),
          });
        } else if (block.type === 'tool_result' && block.tool_use_id) {
          const id = String(block.tool_use_id);
          if (!results.has(id)) {
            results.set(id, { text: flattenResultContent(block.content), endOffset });
          }
        }
      }
    }
    // Task notification: id and status matched in the ENVELOPE ONLY (before
    // the first <result>) — a report QUOTING another task's markers must not
    // satisfy that task (same defect class as issues #9/#11).
    if (
      obj.type === 'user' &&
      !('toolUseResult' in obj) &&
      obj.origin &&
      obj.origin.kind === 'task-notification' &&
      obj.message &&
      typeof obj.message.content === 'string'
    ) {
      const parts = obj.message.content.split('<result>');
      if (parts.length > 1) {
        const envelope = parts[0];
        const m = envelope.match(/<task-id>([A-Za-z0-9_-]{1,64})<\/task-id>/);
        if (m && envelope.includes('<status>completed</status>')) {
          const body = parts.slice(1).join('<result>').split('</result>')[0];
          let text = null;
          try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
              text = parsed.content;
            }
          } catch {
            /* fail-closed: no verdict carrier */
          }
          if (text !== null && !tasks.has(m[1])) {
            tasks.set(m[1], { text, endOffset });
          }
        }
      }
    }
  }
  // Self-certifying snapshot (round 20): the digest of the exact bytes THIS
  // scan parsed, so a consumer that decided something from this snapshot can
  // later ask "is the live file still byte-identical over what I read?"
  // without trusting a second read to have seen the same state.
  const selfDigest = opts.selfDigest
    ? 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
    : null;
  return {
    size,
    parsedUpto: fromOffset + pos,
    entries,
    results,
    tasks,
    idCounts,
    idMaxEnd,
    selfDigest,
    selfDigestUpto: fromOffset + buf.length,
  };
}

// ---------------------------------------------------------------------------
// The reducer. A dispatch's state is the FOLD of its records in append order.
// Pinned rules (§3.4): contested has absolute precedence and wins in BOTH
// orders; valid transitions are in-flight → bound → settled, in-flight/bound
// → contested, in-flight/bound → expired, in-flight → ambiguous (refused on
// bound), bound → owned → settled; born-bound via bound_tooluse_id on the
// base line; payload-identical duplicates are idempotent, conflicting ones
// fail closed to contested; a post-terminal event refuses — with TWO pinned
// exceptions: a contested ack matching a derived contest is silent, and
// debt_cleared is honoured on a terminal never-bound record (refused loudly
// on a bound or live one — it would forge a balance no ledger computed); an event
// with no base record is ignored and reported; an unknown event kind poisons
// its dispatch fail-closed. The single-in-flight rule is ALSO a read-time
// invariant: D2's base line landing while same-key D1 was nonterminal ∧
// un-owned folds BOTH to contested whether or not explicit events were ever
// written.
// ---------------------------------------------------------------------------

function isNonterminalUnowned(D) {
  return D.state === 'in-flight' || D.state === 'bound';
}

function parseTimeMs(t) {
  if (typeof t !== 'string') return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

// Log-side age, exclusive boundary; a malformed or FUTURE writer stamp fails
// closed to "expired for pairing, retained for exclusion" (§3.4 expiry).
function expiredForPairing(rec, nowMs) {
  const t = parseTimeMs(rec && rec.time);
  if (t === null) return true;
  if (t > nowMs) return true;
  return nowMs - t >= EXPIRY_MS;
}

// Retention (deletion) is STRICTER than pairing exclusion — the two must
// never share a predicate: "expired for pairing, retained for exclusion"
// (§3.4 expiry) means a malformed or future stamp poisons pairing immediately
// but may only be dropped once a VALID stamp has genuinely aged 48h. Reusing
// expiredForPairing here would delete a future-dated record on the spot and
// reopen the transcript identity its window closes.
function agedForRetention(rec, nowMs) {
  const t = parseTimeMs(rec && rec.time);
  if (t === null) return false;
  if (t > nowMs) return false;
  return nowMs - t >= EXPIRY_MS;
}

function foldRecords(records) {
  const dispatches = new Map(); // dispatch_id -> D
  const bySessionKey = new Map(); // `${session}\u0000${key}` -> [dispatch_id]
  const spent = new Set(); // schema-borne: every settlement record's completion_id
  const dispositions = [];
  const disposedTooluse = new Map(); // tooluseId -> ALL disposition records (cross-file aliases stay distinguishable)
  // EVERY frontier record survives the fold: applicability is proven per
  // record by content at use time, and a numerically-larger frontier can be
  // inapplicable (suffix rewrite) while a smaller one still validly excludes -
  // keeping only the max would silently drop the smaller coverage.
  const frontiers = []; // all frontier records; applicableFrontiers validates each
  const seqHwm = new Map(); // session_id -> max seq ever allocated (survives dispatch retention)
  const activations = new Map(); // session_id -> first activation record
  const reports = [];

  const skOf = (s, k) => `${s}\u0000${k}`;

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    switch (rec.kind) {
      case 'dispatch': {
        if (typeof rec.dispatch_id !== 'string' || typeof rec.session_id !== 'string' || typeof rec.key !== 'string') {
          reports.push('malformed dispatch record ignored');
          break;
        }
        if (dispatches.has(rec.dispatch_id)) {
          reports.push(`duplicate dispatch base record ${rec.dispatch_id} ignored`);
          break;
        }
        const D = {
          id: rec.dispatch_id,
          rec,
          sessionId: rec.session_id,
          key: rec.key,
          seq: rec.seq,
          planes: rec.planes && typeof rec.planes === 'object' ? rec.planes : {},
          frontierStart: typeof rec.frontier_start === 'number' ? rec.frontier_start : null,
          state: rec.bound_tooluse_id ? 'bound' : 'in-flight',
          bornBound: !!rec.bound_tooluse_id,
          boundTooluseId: rec.bound_tooluse_id ? String(rec.bound_tooluse_id) : null,
          // Content proof of the bound entry (round 17): offsets + digest,
          // recorded at bind time, re-verified at settlement. Absent on a
          // legacy or crafted record → settlement refuses, fail-closed.
          boundStart: Number.isInteger(rec.bound_start_offset) ? rec.bound_start_offset : null,
          boundEnd: Number.isInteger(rec.bound_end_offset) ? rec.bound_end_offset : null,
          boundDigest:
            typeof rec.bound_range_digest === 'string' && rec.bound_range_digest.length > 0
              ? rec.bound_range_digest
              : null,
          ownedTaskId: null,
          frontierEnd: null,
          settlement: null,
          derivedContest: false,
          hasContestedAck: false,
          debtCleared: false,
        };
        const sk = skOf(D.sessionId, D.key);
        // Read-time twin-contested invariant: derived from the RELATIVE
        // POSITION of the two base lines, never dependent on acknowledgment
        // events surviving a crash.
        for (const prevId of bySessionKey.get(sk) || []) {
          const P = dispatches.get(prevId);
          if (P && isNonterminalUnowned(P)) {
            P.state = 'contested';
            P.derivedContest = true;
            D.state = 'contested';
            D.derivedContest = true;
            reports.push(`read-time contest: ${P.id} and ${D.id} share key while first is in-flight`);
          }
        }
        dispatches.set(D.id, D);
        if (!bySessionKey.has(sk)) bySessionKey.set(sk, []);
        bySessionKey.get(sk).push(D.id);
        break;
      }
      case 'dispatch_event': {
        const D = dispatches.get(rec.dispatch_id);
        if (!D) {
          reports.push(`event ${rec.event} for unknown dispatch ${rec.dispatch_id} ignored`);
          break;
        }
        const ev = rec.event;
        if (!EVENT_KINDS.has(ev)) {
          D.state = 'poisoned';
          reports.push(`unknown event kind ${JSON.stringify(ev)} poisons ${D.id} fail-closed`);
          break;
        }
        if (ev === 'debt_cleared') {
          // Durable ledger balance for a terminal never-bound record: its
          // owed entry was matched by an in-window payment (aggregate per
          // key), persisted so compaction folding the paying dispositions
          // into a frontier later cannot re-arm the hazard. Refused on any
          // record that does not owe — a bound or live dispatch has no debt
          // this event could clear, and honouring it would forge one.
          if (TERMINAL_STATES.has(D.state) && !D.boundTooluseId) {
            D.debtCleared = true;
          } else {
            reports.push(`debt_cleared on ${D.state} dispatch ${D.id} refused`);
          }
          break;
        }
        if (TERMINAL_STATES.has(D.state)) {
          if (ev === 'contested' && D.state === 'contested') {
            // Silent durable ack. It may carry the frontier_end a derived
            // contest never got — a never-bound contested dispatch's claim
            // window must not stay open-ended.
            D.hasContestedAck = true;
            if (!D.boundTooluseId && D.frontierEnd === null && typeof rec.frontier_end === 'number') {
              D.frontierEnd = rec.frontier_end;
            }
            break;
          }
          reports.push(`post-terminal event ${ev} on ${D.id} (${D.state}) refused`);
          break;
        }
        switch (ev) {
          case 'contested':
            D.state = 'contested';
            D.hasContestedAck = true;
            if (!D.boundTooluseId && typeof rec.frontier_end === 'number') {
              D.frontierEnd = rec.frontier_end;
            }
            break;
          case 'bound':
            if (D.state === 'in-flight') {
              D.state = 'bound';
              D.boundTooluseId = String(rec.tooluse_id || '');
              D.boundStart = Number.isInteger(rec.start_offset) ? rec.start_offset : null;
              D.boundEnd = Number.isInteger(rec.end_offset) ? rec.end_offset : null;
              D.boundDigest =
                typeof rec.range_digest === 'string' && rec.range_digest.length > 0
                  ? rec.range_digest
                  : null;
            } else if (D.state === 'bound') {
              // Idempotent ONLY when payload-identical (round 18): the
              // proof fields are load-bearing — a second bound event
              // agreeing on the id but disagreeing on offsets or digest is
              // two different byte claims, and honouring either would let
              // a forged duplicate swap the proof under a real bind.
              const dupStart = Number.isInteger(rec.start_offset) ? rec.start_offset : null;
              const dupEnd = Number.isInteger(rec.end_offset) ? rec.end_offset : null;
              const dupDigest =
                typeof rec.range_digest === 'string' && rec.range_digest.length > 0
                  ? rec.range_digest
                  : null;
              if (
                String(rec.tooluse_id || '') !== D.boundTooluseId ||
                dupStart !== D.boundStart ||
                dupEnd !== D.boundEnd ||
                dupDigest !== D.boundDigest
              ) {
                D.state = 'contested';
                reports.push(`conflicting bound events on ${D.id} → contested`);
              }
            } else {
              reports.push(`bound event on ${D.state} dispatch ${D.id} refused`);
            }
            break;
          case 'owned':
            if (D.state === 'bound') {
              D.state = 'owned';
              D.ownedTaskId = String(rec.task_id || '');
            } else if (D.state === 'owned') {
              if (String(rec.task_id || '') !== D.ownedTaskId) {
                D.state = 'contested';
                reports.push(`conflicting owned events on ${D.id} → contested`);
              }
            } else {
              reports.push(`owned event on ${D.state} dispatch ${D.id} refused`);
            }
            break;
          case 'expired':
            if (D.state === 'in-flight' || D.state === 'bound') {
              if (!D.boundTooluseId && typeof rec.frontier_end === 'number') {
                D.frontierEnd = rec.frontier_end;
              }
              D.state = 'expired';
            } else {
              reports.push(`expired event on ${D.state} dispatch ${D.id} refused`);
            }
            break;
          case 'ambiguous':
            if (D.state === 'in-flight') {
              D.state = 'ambiguous';
              if (typeof rec.frontier_end === 'number') D.frontierEnd = rec.frontier_end;
            } else {
              reports.push(`ambiguous event on ${D.state} dispatch ${D.id} refused`);
            }
            break;
        }
        break;
      }
      case 'settlement': {
        if (typeof rec.completion_id === 'string' && rec.completion_id) {
          spent.add(rec.completion_id); // schema-borne, unconditional
        }
        const D = dispatches.get(rec.dispatch_id);
        if (!D) {
          reports.push(`settlement for unknown dispatch ${rec.dispatch_id} — identity spent, nothing bound`);
          break;
        }
        if (D.state === 'bound' || D.state === 'owned') {
          D.state = 'settled';
          D.settlement = rec;
        } else if (D.state === 'contested') {
          reports.push(`settlement on contested dispatch ${D.id} refused (contested precedence absolute)`);
        } else {
          reports.push(`settlement on ${D.state} dispatch ${D.id} refused`);
        }
        break;
      }
      case 'tooluse_disposition': {
        if (typeof rec.tooluse_id === 'string' && rec.tooluse_id) {
          dispositions.push(rec);
          if (!disposedTooluse.has(rec.tooluse_id)) disposedTooluse.set(rec.tooluse_id, []);
          disposedTooluse.get(rec.tooluse_id).push(rec);
        }
        break;
      }
      case 'frontier': {
        if (
          typeof rec.session_id === 'string' &&
          typeof rec.key === 'string' &&
          typeof rec.transcript_file_id === 'string' &&
          typeof rec.upto_end === 'number'
        ) {
          frontiers.push(rec); // ALL records kept - see the fold-state comment above
        }
        break;
      }
      case 'activation': {
        if (
          typeof rec.session_id === 'string' &&
          typeof rec.transcript_file_id === 'string' &&
          typeof rec.activated_at === 'number' &&
          typeof rec.activation_prefix_digest === 'string'
        ) {
          if (!activations.has(rec.session_id)) activations.set(rec.session_id, rec);
        }
        break;
      }
      case 'seq_hwm': {
        // Per-session sequence high-water mark: dispatch identity is stable
        // and never reused, so the allocator's floor must survive the base
        // records compaction drops (§3.4 — dispatch_id = (session_id, seq)).
        if (typeof rec.session_id === 'string' && typeof rec.seq === 'number') {
          const prev = seqHwm.get(rec.session_id) || 0;
          if (rec.seq > prev) seqHwm.set(rec.session_id, rec.seq);
        }
        break;
      }
      default:
        break; // verdict / tombstone / unknown kinds live under other sections' rules
    }
  }

  return { dispatches, bySessionKey, spent, dispositions, disposedTooluse, frontiers, activations, seqHwm, reports };
}

// ---------------------------------------------------------------------------
// Log location + cursor. The cursor is availability state only: its loss or
// invalidity costs exactly one full rescan, never correctness — candidate
// isolation lives in the disposition records and frontier coverage (§3.4
// rescan safety), so nothing here is load-bearing enough to fsync.
// ---------------------------------------------------------------------------

function logFileOf(repoRoot) {
  return receiptLog.resolveReceiptPaths(repoRoot);
}

function cursorPath(dir, sessionId) {
  const slug = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '-');
  return path.join(dir, `cursor-${slug}.json`);
}

function readCursor(dir, sessionId, currentFileId) {
  try {
    const c = JSON.parse(fs.readFileSync(cursorPath(dir, sessionId), 'utf8'));
    if (
      c &&
      typeof c === 'object' &&
      c.transcript_file_id === currentFileId &&
      typeof c.offset === 'number' &&
      c.offset >= 0
    ) {
      return c;
    }
  } catch {
    /* absent or damaged → full rescan */
  }
  return null;
}

function writeCursor(dir, sessionId, cursor) {
  const p = cursorPath(dir, sessionId);
  const tmp = `${p}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(cursor), { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Activation barrier. Written at SessionStart (before any tool call exists) or
// lazily at first protocol contact. Every USE requires both the file identity
// match AND the recomputed digest of [0, activated_at) to equal
// activation_prefix_digest — either mismatch disables capture-time binding
// entirely (§3.4 visibility).
// ---------------------------------------------------------------------------

function buildActivationRecord(sessionId, tPath) {
  const size = fs.statSync(tPath).size;
  return {
    v: 1,
    kind: 'activation',
    session_id: sessionId,
    transcript_file_id: transcriptFileId(tPath),
    activated_at: size,
    activation_prefix_digest: prefixDigest(tPath, size),
    time: receiptLog.nowISO(),
  };
}

// Idempotent: a session with an activation record on file appends nothing.
function appendActivation(repoRoot, { sessionId, transcriptPath }) {
  const { file } = logFileOf(repoRoot);
  return receiptLog.withFileLock(file, handle => {
    const { records } = receiptLog.readRecords(file);
    const fold = foldRecords(records);
    if (fold.activations.has(sessionId)) return { ok: true, existed: true };
    const rec = buildActivationRecord(sessionId, transcriptPath);
    receiptLog.stageAndCommit(file, handle, [rec]);
    return { ok: true, existed: false, record: rec };
  });
}

function validActivation(fold, sessionId, tPath, currentFileId) {
  const act = fold.activations.get(sessionId);
  if (!act) return null;
  if (act.transcript_file_id !== currentFileId) return null;
  if (prefixDigest(tPath, act.activated_at) !== act.activation_prefix_digest) return null;
  return act;
}

// ---------------------------------------------------------------------------
// Shared candidate accounting. An entry is EXCLUDED when a disposition names
// it, a dispatch is bound to it (identity-accounted), or an APPLICABLE
// frontier covers its end offset — applicability itself is proven by content
// (file identity + recomputed prefix digest), and a stale frontier can only
// over-quarantine, never re-admit (§3.4 rescan safety).
// ---------------------------------------------------------------------------

function applicableFrontiers(fold, sessionId, tPath, currentFileId) {
  const out = [];
  for (const f of fold.frontiers) {
    // Every record is validated independently — no max-selection first. A
    // larger frontier with a stale digest must never shadow a smaller one
    // that still verifies (§3.4 rescan safety: shrink coverage, never guess).
    if (f.session_id !== sessionId) continue;
    if (f.transcript_file_id !== currentFileId) continue;
    if (typeof f.upto_end !== 'number' || typeof f.prefix_digest !== 'string') continue;
    if (prefixDigest(tPath, f.upto_end) !== f.prefix_digest) continue;
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hazard ledger for one (session, key): nothing binds until every prior
// same-key claim window is accounted. Each terminal never-bound dispatch
// owes ONE entry; a payment is a same-key disposition INSIDE an owed window
// by the SAME membership predicate binding uses (end_offset overlap alone
// is not membership). Payments are OBSERVATIONS, normalized by
// addObservation — deduped by (transcript_file_id, tooluse_id); an exact
// recovery-duplicate is one observation, copies that CONFLICT on offsets
// prove nothing — and one observation pays ONE window (windowsMatchable:
// maximum bipartite matching, never an aggregate count). Sweep step 2b
// closes windows with the SAME normalization and matching, against its
// prospective ends. An open or EMPTY window (frontier_end <=
// frontier_start) is unpayable: the key stays degraded. An invalid
// same-key frontier for this file is independent hazard evidence. A
// balanced ledger persists as `debt_cleared` so compaction cannot re-arm
// it. While active: quarantine and poison, never bind.
// Full rationale: 2-content-addressed-receipts.md §3.4 hazard ledger.
// ---------------------------------------------------------------------------

function addObservation(obs, fileId, tooluseId, start, end, digest) {
  // Only a real transcript byte range is an observation: finite integers,
  // 0 <= start < end (round 9 — a zero-length or reversed pair is not a
  // place an entry could have been read from, and admitting one would let
  // it match inside a genuine window). Normalize FIRST, verify once per
  // unique survivor (round 10): duplicates must not amplify digest I/O.
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return;
  const oid = JSON.stringify([fileId, tooluseId]);
  const prev = obs.get(oid);
  if (!prev) {
    obs.set(oid, { fileId, start, end, digest, conflicted: false });
  } else if (prev.start !== start || prev.end !== end || prev.digest !== digest) {
    prev.conflicted = true; // conflicting copies prove nothing, fail-closed
  }
}

// A durable disposition enters a matching graph only with CONTENT proof:
// it names the current transcript file AND its recorded range digest
// recomputes over the current bytes. transcript_file_id alone is dev +
// inode + first-line hash — a truncate-in-place rebuild can keep it while
// the bytes underneath change, and a stale offset pair that happens to fit
// a newer window would mint `debt_cleared` against an entry that was never
// observed (round 9). A proof-less or unverifiable record still SUPPRESSES
// (undisposedEntries); it never pays and never closes a window.
// Verification is memoized per lock-held operation by content identity.
function verifiedObservations(obs, currentFileId, tPath, memo) {
  const out = [];
  for (const o of obs.values()) {
    if (o.conflicted) continue;
    if (o.fileId !== currentFileId) continue;
    if (typeof o.digest !== 'string' || !o.digest) continue;
    const mk = JSON.stringify(['range', o.fileId, o.start, o.end, o.digest]);
    let v = memo.get(mk);
    if (v === undefined) {
      let d2 = null;
      try {
        d2 = rangeDigest(tPath, o.start, o.end);
      } catch {
        d2 = null;
      }
      v = d2 !== null && d2 === o.digest;
      memo.set(mk, v);
    }
    if (v) out.push(o);
  }
  return out;
}

// The owed WINDOW needs its own epoch anchor, symmetric to the payment's
// (round 10): a dispatch record's frontier_digest is the prefix digest of
// [0, frontier_start) at dispatch time. Without it a truncate-in-place
// rebuild leaves the window floating — a NEW epoch's genuinely verified
// entry lands inside the old numeric range and clears a debt whose real
// entry never arrived. A window whose anchor cannot verify accepts no
// observation and never clears — permanently unpayable, fail-closed.
function windowAnchorVerifies(D, currentFileId, tPath, memo) {
  if (D.rec.transcript_file_id !== currentFileId) return false;
  const dg = D.rec.frontier_digest;
  if (typeof dg !== 'string' || !dg) return false;
  if (!Number.isInteger(D.frontierStart) || D.frontierStart < 0) return false;
  const mk = JSON.stringify(['window', currentFileId, D.frontierStart, dg]);
  let v = memo.get(mk);
  if (v === undefined) {
    let p = null;
    try {
      p = prefixDigest(tPath, D.frontierStart);
    } catch {
      p = null;
    }
    v = p !== null && p === dg;
    memo.set(mk, v);
  }
  return v;
}

function windowsMatchable(windows, obsList, endOf, windowOk) {
  const fits = (o, D) => {
    if (!windowOk(D)) return false;
    const e2 = endOf(D);
    return (
      D.frontierStart !== null &&
      typeof e2 === 'number' &&
      o.fileId === D.rec.transcript_file_id &&
      o.start >= D.frontierStart &&
      o.end <= e2
    );
  };
  const pays = new Array(obsList.length).fill(-1);
  const assign = (wi, seen) => {
    for (let oi = 0; oi < obsList.length; oi++) {
      if (seen[oi] || !fits(obsList[oi], windows[wi])) continue;
      seen[oi] = true;
      if (pays[oi] === -1 || assign(pays[oi], seen)) {
        pays[oi] = wi;
        return true;
      }
    }
    return false;
  };
  for (let wi = 0; wi < windows.length; wi++) {
    if (!assign(wi, new Array(obsList.length).fill(false))) return false;
  }
  return true;
}

function owingDispatches(group) {
  return group.filter(D => TERMINAL_STATES.has(D.state) && !D.boundTooluseId && !D.debtCleared);
}

// A tooluse identity is bindable only while the scan shows ONE copy of it
// (round 14): capture and eager binding attribute "this call's own entry"
// by identity, and settlement pairs results by that same identity — an id
// carried by two different tool_use blocks makes every downstream
// attribution undecidable (a PASS returned for one request could settle
// the other's dispatch). ANY second occurrence conflicts — same-line
// copies share offsets AND digest yet are still two distinct calls (round
// 15), so no field comparison can whitelist a duplicate — and the count
// covers EVERY tool_use in the scan, protocol or not (round 17): the
// result namespace is shared with every tool, so a non-review call's id
// collision poisons attribution identically. A conflicted id is never
// bound — a bind decision that sees one poisons `ambiguous` instead — and
// 2b admits it to no key's matching.
function conflictedScanIds(scan) {
  const bad = new Set();
  for (const [id, n] of scan.idCounts) {
    if (n >= 2) bad.add(id);
  }
  return bad;
}

function keyHazardActive(fold, sk, sessionId, key, currentFileId, transcriptPath, frontierList, pendingAppends, digestMemo) {
  const group = (fold.bySessionKey.get(sk) || [])
    .map(id => fold.dispatches.get(id))
    .filter(Boolean);
  const owing = owingDispatches(group);
  if (owing.length > 0) {
    if (
      owing.some(
        D => D.frontierStart === null || D.frontierEnd === null || D.frontierEnd <= D.frontierStart
      )
    ) {
      return true;
    }
    const memo = digestMemo || new Map();
    const obs = new Map();
    const takeObs = d => {
      if (d.session_id !== sessionId || d.key !== key) return;
      addObservation(obs, d.transcript_file_id, d.tooluse_id, d.start_offset, d.end_offset, d.range_digest);
    };
    for (const d of fold.dispositions) takeObs(d);
    for (const r of pendingAppends || []) {
      if (r.kind === 'tooluse_disposition') takeObs(r);
    }
    const obsList = verifiedObservations(obs, currentFileId, transcriptPath, memo);
    const windowOk = D => windowAnchorVerifies(D, currentFileId, transcriptPath, memo);
    if (!windowsMatchable(owing, obsList, D => D.frontierEnd, windowOk)) return true;
  }
  return fold.frontiers.some(
    f =>
      f.session_id === sessionId &&
      f.key === key &&
      f.transcript_file_id === currentFileId &&
      !frontierList.includes(f)
  );
}

function undisposedEntries(fold, entries, frontierList, sessionId, currentFileId) {
  // tooluse_ids alias across sessions and rebuilt/forked transcript files
  // (§3.4): a record that NAMES its scope suppresses an entry only under
  // (session, file) BOTH matching — the same scope applicableFrontiers
  // grants a frontier, so compaction folding a disposition into a frontier
  // preserves the exclusion's reach instead of silently changing it (round
  // 8). A predecessor session's entries never reach a bind here anyway: the
  // activation barrier quarantines below activated_at and frontier-only
  // binding claims nothing below frontier_start, so cross-session
  // non-suppression cannot double-settle. A legacy file-less record still
  // suppresses globally, fail-closed: suppression only prevents a bind.
  const boundIds = new Set();
  for (const D of fold.dispatches.values()) {
    if (!D.boundTooluseId) continue;
    const f = D.rec.transcript_file_id;
    if (typeof f === 'string' && (f !== currentFileId || D.sessionId !== sessionId)) continue;
    boundIds.add(D.boundTooluseId);
  }
  return entries.filter(e => {
    const copies = fold.disposedTooluse.get(e.tooluseId);
    if (
      copies &&
      copies.some(
        d =>
          typeof d.transcript_file_id !== 'string' ||
          (d.transcript_file_id === currentFileId && d.session_id === sessionId)
      )
    ) {
      return false;
    }
    if (boundIds.has(e.tooluseId)) return false;
    for (const f of frontierList) {
      if (f.key === e.key && e.endOffset <= f.upto_end) return false;
    }
    return true;
  });
}

// A frontier's `tooluse_ids` is consumed only through this validator
// (round 16): malformed presence is treated as ABSENT — a bare string must
// not be iterated character-by-character into false conflicts, a truthy
// non-array must not throw mid-sweep, and an unvalidated shape must never
// count as the identity summary that licenses deleting dispositions.
// All-or-nothing (round 17): one malformed element voids the WHOLE field —
// filtering would let a mixed array count as identity coverage here while
// an implementation of the pinned spec derives nothing from it.
function validTooluseIds(rec) {
  if (!Array.isArray(rec.tooluse_ids)) return [];
  return rec.tooluse_ids.every(id => typeof id === 'string' && id.length > 0)
    ? rec.tooluse_ids
    : [];
}

// Content proof of a bound entry at settlement time (round 17): the bind
// recorded the entry's offsets and parse-time digest; consuming the bound
// identity re-verifies those bytes against the CURRENT transcript. A
// truncate-in-place rebuild that preserves file identity (same inode, same
// first line) can replace the entry while the id lives on in a
// replacement — without this proof, either bind kind would settle from
// bytes it never bound. Absent fields (legacy or crafted records) fail
// closed: refuse, expiry retires the dispatch.
function boundEntryVerifies(D, currentFileId, tPath, memo) {
  if (D.rec.transcript_file_id !== currentFileId) return false;
  if (!Number.isInteger(D.boundStart) || !Number.isInteger(D.boundEnd)) return false;
  if (D.boundStart < 0 || D.boundEnd <= D.boundStart) return false;
  if (typeof D.boundDigest !== 'string' || D.boundDigest.length === 0) return false;
  const k = JSON.stringify(['range', currentFileId, D.boundStart, D.boundEnd, D.boundDigest]);
  if (memo.has(k)) return memo.get(k);
  let ok = false;
  try {
    ok = rangeDigest(tPath, D.boundStart, D.boundEnd) === D.boundDigest;
  } catch {
    ok = false;
  }
  memo.set(k, ok);
  return ok;
}

// Durable identity facts (round 15): every tooluse id this ledger has ever
// attributed — disposed, bound, or folded into a frontier's `tooluse_ids` —
// under the SAME suppression scope undisposedEntries applies. A pending
// entry carrying such an id is necessarily a reuse: the occurrence that
// earned the fact is suppressed by that very fact, so the entry in front of
// us is a different line. Dispositions and bound records already suppress
// their ids out of pending entirely; the frontier list is the load-bearing
// source — compaction deletes the dispositions it folds, and without the
// folded ids a post-compaction rescan would greet a reused identity as
// fresh. A legacy frontier without the field contributes nothing.
function knownTooluseIds(fold, sessionId, currentFileId, frontierList) {
  const ids = new Set();
  for (const [id, copies] of fold.disposedTooluse) {
    if (
      copies.some(
        d =>
          typeof d.transcript_file_id !== 'string' ||
          (d.transcript_file_id === currentFileId && d.session_id === sessionId)
      )
    ) {
      ids.add(id);
    }
  }
  for (const D of fold.dispatches.values()) {
    if (!D.boundTooluseId) continue;
    const f = D.rec.transcript_file_id;
    if (typeof f === 'string' && (f !== currentFileId || D.sessionId !== sessionId)) continue;
    ids.add(D.boundTooluseId);
  }
  for (const f of frontierList) {
    for (const id of validTooluseIds(f)) ids.add(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// PreToolUse producer: allocate the dispatch, run the single-in-flight check,
// bring same-key accounting current, and decide visibility — capture-time
// bind on the dispatch line itself, frontier-only, or `ambiguous` poisoning.
// A failure to durably append is the caller's exit-2 duty: this function
// throws, the CLI exits non-zero, the hook blocks the call (§3.4).
// ---------------------------------------------------------------------------

function appendDispatch(repoRoot, { sessionId, transcriptPath, toolInput, planes, now }) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const { file } = logFileOf(repoRoot);
  const key = requestKey(toolInput);
  const planeNames = Object.keys(planes || {});
  if (planeNames.length === 0 || !planeNames.every(p => REVIEW_PLANES.has(p))) {
    throw new Error(`dispatch-log: invalid planes ${JSON.stringify(planeNames)}`);
  }

  return receiptLog.withFileLock(file, handle => {
    const { records } = receiptLog.readRecords(file);
    const fold = foldRecords(records);
    const toAppend = [];
    const reports = [];

    // Seq allocation: max seq this session has ever used, plus one — stable
    // and never reused, even across contested/expired predecessors AND across
    // compaction dropping every older base record (the seq_hwm floor).
    let maxSeq = fold.seqHwm.get(sessionId) || 0;
    for (const D of fold.dispatches.values()) {
      if (D.sessionId === sessionId && typeof D.seq === 'number' && D.seq > maxSeq) maxSeq = D.seq;
    }
    const seq = maxSeq + 1;
    const dispatchId = `${sessionId}#${seq}`;
    // The writer stamp derives from the injected clock: expiry is judged
    // against the same nowMs, so stamping from a second clock read would let
    // the two disagree by the width of the race (a stamp microseconds past a
    // reader's nowMs is "future" and fail-closed expires the fresh record).
    const time = new Date(nowMs).toISOString();

    // Transcript observation under the lock. Unreadable transcript →
    // accounting cannot be brought current → the new dispatch poisons
    // `ambiguous` (fail-closed, never a guess), but the dispatch record
    // itself still lands so the call is never unrecorded.
    let scan = null;
    let currentFileId = null;
    try {
      currentFileId = transcriptFileId(transcriptPath);
      scan = scanTranscript(transcriptPath, 0);
    } catch {
      scan = null;
    }

    if (scan === null) {
      const base = {
        v: 1,
        kind: 'dispatch',
        dispatch_id: dispatchId,
        session_id: sessionId,
        seq,
        key,
        planes,
        transcript_file_id: null,
        frontier_start: null,
        time,
      };
      const amb = {
        v: 1,
        kind: 'dispatch_event',
        dispatch_id: dispatchId,
        event: 'ambiguous',
        time,
      };
      reports.push(`transcript unreadable at dispatch — ${dispatchId} poisoned ambiguous`);
      receiptLog.stageAndCommit(file, handle, [base, amb]);
      return { ok: true, dispatchId, key, state: 'ambiguous', reports };
    }

    // The claim window starts at the TRUE causal boundary — every byte
    // physically written before this dispatch, parsed or torn (§3.4). A torn
    // tail here might be this call's own entry mid-write (excluding it costs
    // one wasted review) or an older stalled partial (claiming it once
    // completed would settle a stale result as this call's own). Fail closed:
    // size, not parsedUpto. parsedUpto is the CURSOR's boundary, never the
    // window's.
    const frontierStart = scan.size;

    // Identities the whole scan shows more than once — never bindable
    // (round 14, conflictedScanIds).
    const conflictedIds = conflictedScanIds(scan);

    // Window epoch anchor (round 10): the debt window is only meaningful in
    // the transcript epoch whose prefix [0, frontier_start) had exactly
    // these bytes. Payments prove their own range; without an anchor the
    // WINDOW floats across a truncate-in-place rebuild and a new epoch's
    // verified entry pays an old epoch's debt. Uncomputable → null → the
    // window is permanently unpayable (fail-closed).
    let frontierDigest = null;
    try {
      frontierDigest = prefixDigest(transcriptPath, frontierStart);
    } catch {
      frontierDigest = null;
    }

    // One digest-verification memo per lock-held operation (round 10 P2):
    // dedupe happens first in addObservation, verification once per unique
    // (file, start, end, digest) survivor.
    const digestMemo = new Map();

    // Lazy activation at first protocol contact for sessions predating the
    // writer's deployment. activated_at = the CURRENT size, so this call's
    // own already-visible entry is pre-barrier and will be quarantined — one
    // wasted review at the rollout boundary, fail-closed.
    let act = validActivation(fold, sessionId, transcriptPath, currentFileId);
    let lazyActivation = null;
    if (!fold.activations.has(sessionId)) {
      lazyActivation = buildActivationRecord(sessionId, transcriptPath);
      toAppend.push(lazyActivation);
      act = null; // conservatively no capture-time bind on the activating call itself
      reports.push(`lazy activation for session ${sessionId} at offset ${lazyActivation.activated_at}`);
    }

    // Single-in-flight rule: a same-key dispatch still nonterminal ∧ un-owned
    // → BOTH contested. Explicit acks are appended as durable acknowledgment,
    // idempotent with the read-time rule; the prefix "D1, D2, crash" already
    // folds to contested without them.
    const sk = `${sessionId}\u0000${key}`;
    const inFlightTwins = (fold.bySessionKey.get(sk) || [])
      .map(id => fold.dispatches.get(id))
      .filter(D => D && isNonterminalUnowned(D));
    if (inFlightTwins.length > 0) {
      const base = {
        v: 1,
        kind: 'dispatch',
        dispatch_id: dispatchId,
        session_id: sessionId,
        seq,
        key,
        planes,
        transcript_file_id: currentFileId,
        frontier_start: frontierStart,
        frontier_digest: frontierDigest,
        time,
      };
      toAppend.push(base);
      // No frontier_end here, deliberately: the contested calls' own entries
      // have not landed yet (PreToolUse precedes execution), and a window
      // closed now would misfile them as `unaccounted`. The window stays
      // open until a sweep's contested-ack materialization closes it at
      // parsedUpto — after the entries it must cover are inside.
      for (const twin of inFlightTwins) {
        toAppend.push({ v: 1, kind: 'dispatch_event', dispatch_id: twin.id, event: 'contested', time });
        reports.push(`single-in-flight: ${twin.id} contested by ${dispatchId}`);
      }
      toAppend.push({
        v: 1,
        kind: 'dispatch_event',
        dispatch_id: dispatchId,
        event: 'contested',
        time,
      });
      receiptLog.stageAndCommit(file, handle, toAppend);
      return { ok: true, dispatchId, key, state: 'contested', reports };
    }

    // Accounting precondition — resolve every terminal same-key dispatch's
    // claim window before deciding anything, quarantining the unclaimed
    // candidate inside it.
    const frontierList = applicableFrontiers(fold, sessionId, transcriptPath, currentFileId);
    // A pending entry whose id the ledger already attributed is a reuse
    // (round 15, knownTooluseIds) — as unbindable as a scan-visible twin.
    const pendingAll = undisposedEntries(fold, scan.entries, frontierList, sessionId, currentFileId);
    const knownIds = knownTooluseIds(fold, sessionId, currentFileId, frontierList);
    for (const e of pendingAll) {
      if (knownIds.has(e.tooluseId)) conflictedIds.add(e.tooluseId);
    }
    const sameKey = pendingAll.filter(e => e.key === key);
    const activatedAt = act ? act.activated_at : null;
    const claimed = new Set();
    for (const id of fold.bySessionKey.get(sk) || []) {
      const D = fold.dispatches.get(id);
      if (!D || !TERMINAL_STATES.has(D.state) || D.boundTooluseId) continue;
      if (D.frontierStart === null || D.frontierEnd === null) continue;
      for (const e of sameKey) {
        if (claimed.has(e.tooluseId)) continue;
        if (e.startOffset >= D.frontierStart && e.endOffset <= D.frontierEnd) {
          claimed.add(e.tooluseId);
          toAppend.push({
            v: 1,
            kind: 'tooluse_disposition',
            session_id: sessionId,
            key,
            tooluse_id: e.tooluseId,
            reason: 'unaccounted',
            transcript_file_id: currentFileId,
            start_offset: e.startOffset,
            end_offset: e.endOffset,
            range_digest: e.rangeDigest,
            time,
          });
          reports.push(`terminal window of a prior dispatch quarantines entry ${e.tooluseId}`);
        }
      }
    }
    const unclaimed = sameKey.filter(e => !claimed.has(e.tooluseId));

    // Visibility decision. Capture-time bind is only DECIDABLE inside a
    // verified activation barrier: candidates are undisposed unclaimed
    // same-key entries fully written in (activated_at, frontier_start].
    let boundTooluseId = null;
    let boundEntry = null;
    let poisonAmbiguous = false;
    if (act) {
      const visible = unclaimed.filter(
        e => e.endOffset > activatedAt && e.endOffset <= frontierStart
      );
      // Orphan hazard: "an unclaimed visible entry can only be this call's
      // own" rests on every in-barrier entry having a dispatch whose window
      // accounts for it. `keyHazardActive` is the shared ledger judgment
      // (unpaid never-observed-entry debt, or an invalid same-key frontier
      // — see its comment); compaction NEVER drops never-bound terminal
      // dispatches, so the evidence survives. Fail closed: quarantine the
      // candidates and poison this dispatch `ambiguous` (empty window).
      // Staying in-flight would strand a quarantined own-entry's dispatch
      // for 48h and turn every same-key retry into a contest chain;
      // ambiguous costs exactly one wasted review, loud, and a retry on a
      // debt-cleared key proceeds normally. The precondition quarantines
      // committed in toAppend above count as payments already.
      const hazard =
        visible.length > 0 &&
        keyHazardActive(fold, sk, sessionId, key, currentFileId, transcriptPath, frontierList, toAppend, digestMemo);
      if (hazard) {
        poisonAmbiguous = true;
        for (const e of visible) {
          toAppend.push({
            v: 1,
            kind: 'tooluse_disposition',
            session_id: sessionId,
            key,
            tooluse_id: e.tooluseId,
            reason: 'unaccounted',
            transcript_file_id: currentFileId,
            start_offset: e.startOffset,
            end_offset: e.endOffset,
            range_digest: e.rangeDigest,
            time,
          });
        }
        reports.push(
          `capture accounting unverifiable (terminal never-bound dispatch or invalid frontier on this key) — ${visible.length} candidate(s) quarantined, ${dispatchId} poisoned ambiguous`
        );
      } else if (visible.some(e => conflictedIds.has(e.tooluseId))) {
        // A candidate whose identity appears elsewhere in the transcript is
        // unattributable (round 14) — binding the remaining "singleton"
        // would assume the conflicted copy was not this call's own.
        poisonAmbiguous = true;
        for (const e of visible) {
          toAppend.push({
            v: 1,
            kind: 'tooluse_disposition',
            session_id: sessionId,
            key,
            tooluse_id: e.tooluseId,
            reason: 'unaccounted',
            transcript_file_id: currentFileId,
            start_offset: e.startOffset,
            end_offset: e.endOffset,
            range_digest: e.rangeDigest,
            time,
          });
        }
        reports.push(
          `tooluse identity reused across the transcript — ${visible.length} candidate(s) quarantined, ${dispatchId} poisoned ambiguous`
        );
      } else if (visible.length === 1) {
        boundTooluseId = visible[0].tooluseId;
        boundEntry = visible[0];
      } else if (visible.length > 1) {
        poisonAmbiguous = true;
        for (const e of visible) {
          toAppend.push({
            v: 1,
            kind: 'tooluse_disposition',
            session_id: sessionId,
            key,
            tooluse_id: e.tooluseId,
            reason: 'unaccounted',
            transcript_file_id: currentFileId,
            start_offset: e.startOffset,
            end_offset: e.endOffset,
            range_digest: e.rangeDigest,
            time,
          });
        }
        reports.push(
          `${visible.length} same-key candidates visible at capture — ${dispatchId} poisoned ambiguous`
        );
      }
    }

    const base = {
      v: 1,
      kind: 'dispatch',
      dispatch_id: dispatchId,
      session_id: sessionId,
      seq,
      key,
      planes,
      transcript_file_id: currentFileId,
      frontier_start: frontierStart,
      frontier_digest: frontierDigest,
      time,
    };
    if (boundTooluseId) {
      // Bind rides the dispatch line — crash-atomic — WITH the bound
      // entry's content proof (round 17): settlement re-verifies these
      // bytes, so a truncate-in-place rebuild that replaces the captured
      // entry can never settle this dispatch from the replacement.
      base.bound_tooluse_id = boundTooluseId;
      base.bound_start_offset = boundEntry.startOffset;
      base.bound_end_offset = boundEntry.endOffset;
      base.bound_range_digest = boundEntry.rangeDigest;
    }

    // Order is prefix-safe: activation first, dispositions independent,
    // dispatch base before its own events.
    const ordered = [];
    if (lazyActivation) ordered.push(lazyActivation);
    for (const r of toAppend) {
      if (r !== lazyActivation && r.kind === 'tooluse_disposition') ordered.push(r);
    }
    ordered.push(base);
    if (poisonAmbiguous) {
      ordered.push({
        v: 1,
        kind: 'dispatch_event',
        dispatch_id: dispatchId,
        event: 'ambiguous',
        frontier_end: frontierStart,
        time,
      });
    }
    receiptLog.stageAndCommit(file, handle, ordered);
    return {
      ok: true,
      dispatchId,
      key,
      state: poisonAmbiguous ? 'ambiguous' : boundTooluseId ? 'bound' : 'in-flight',
      boundTooluseId,
      frontierStart,
      reports,
      nowMs,
    };
  });
}

// ---------------------------------------------------------------------------
// Background handoff ownership: exactly one un-consumed, un-owned candidate →
// owned by that task_id; zero or ≥2 → mark NONE, refuse loudly (§3.4). Runs a
// sweep first so a bindable dispatch is bound before candidacy is judged.
// ---------------------------------------------------------------------------

function markBackgroundOwned(repoRoot, { sessionId, transcriptPath, key, taskId, now }) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  sweep(repoRoot, { sessionId, transcriptPath, now: nowMs });
  const { file } = logFileOf(repoRoot);
  return receiptLog.withFileLock(file, handle => {
    const { records } = receiptLog.readRecords(file);
    const fold = foldRecords(records);
    const sk = `${sessionId}\u0000${key}`;
    const candidates = (fold.bySessionKey.get(sk) || [])
      .map(id => fold.dispatches.get(id))
      .filter(D => D && D.state === 'bound');
    if (candidates.length !== 1) {
      return {
        ok: false,
        reason: `background handoff: ${candidates.length} candidates for key — marked none`,
      };
    }
    const D = candidates[0];
    // Ownership is an attribution decision like binding (round 15): grant
    // it only while the CURRENT transcript still shows the bound identity
    // once. Unreadable transcript → refuse, fail-closed; a later handoff
    // attempt can retry.
    let ownScan = null;
    try {
      ownScan = scanTranscript(transcriptPath, 0);
    } catch {
      ownScan = null;
    }
    if (ownScan === null) {
      return {
        ok: false,
        reason: 'background handoff: transcript unreadable — ownership refused',
      };
    }
    if (conflictedScanIds(ownScan).has(D.boundTooluseId)) {
      return {
        ok: false,
        reason: `background handoff: bound identity ${D.boundTooluseId} reused across the transcript — ownership refused`,
      };
    }
    // Ownership is an alternate settlement capability (round 18): once
    // owned, the task's report settles WITHOUT the tooluse result path, so
    // the bound entry's content proof must hold at grant time — a rebuild
    // that replaced the entry, or a legacy record with no proof, must not
    // reach task settlement through this door.
    let ownFileId = null;
    try {
      ownFileId = transcriptFileId(transcriptPath);
    } catch {
      ownFileId = null;
    }
    if (ownFileId === null || !boundEntryVerifies(D, ownFileId, transcriptPath, new Map())) {
      return {
        ok: false,
        reason: `background handoff: bound entry of ${D.id} unverifiable — ownership refused`,
      };
    }
    receiptLog.stageAndCommit(file, handle, [
      {
        v: 1,
        kind: 'dispatch_event',
        dispatch_id: D.id,
        event: 'owned',
        task_id: taskId,
        time: new Date(nowMs).toISOString(),
      },
    ]);
    return { ok: true, dispatchId: D.id };
  });
}

// ---------------------------------------------------------------------------
// Settlement construction: per-plane recognition (request side already proven
// at dispatch — the planes map), dual-namespace refusal, endpoint
// revalidation for PASS verdicts (FAIL is negative evidence about the tree it
// observed and is exempt), "no-verdict" as an attempt record.
// ---------------------------------------------------------------------------

const PLANE_TO_TREE = { code_review: 'code', doc_review: 'doc' };

function buildPlaneResults(planes, text, repoRoot, reports) {
  const isDoc = outputIsDocReview(text);
  const isCode = outputIsCodeReview(text);
  const results = {};
  if (isDoc && isCode) {
    for (const p of Object.keys(planes)) results[p] = 'no-verdict';
    reports.push('output claims BOTH review namespaces — every plane settles no-verdict (identity spent, loud)');
    return results;
  }
  let current = null;
  for (const p of Object.keys(planes)) {
    const recognized = (p === 'doc_review' && isDoc) || (p === 'code_review' && isCode);
    if (!recognized) {
      results[p] = 'no-verdict';
      continue;
    }
    const verdict = p === 'doc_review' ? docReviewVerdict(text) : codeReviewVerdict(text);
    if (verdict === null) {
      results[p] = 'no-verdict';
      continue;
    }
    // A null dispatch digest is the degrade marker (undigestable tree at
    // dispatch time). It must never carry a verdict: at result time the tree
    // may STILL be undigestable, and null === null would revalidate a PASS
    // no content ever pinned. Identity is spent, evidence is not minted.
    if (typeof planes[p] !== 'string' || planes[p].length === 0) {
      results[p] = 'no-verdict';
      reports.push(`${p} dispatched with null digest — verdict refused, settled no-verdict`);
      continue;
    }
    if (verdict === 'pass') {
      // Endpoint revalidation: a PASS is appended only when the digest
      // recomputed at result time equals the dispatch digest.
      if (current === null) {
        try {
          current = treeDigest.computeTreeState(fs.realpathSync(repoRoot));
        } catch {
          current = { planes: {} };
        }
      }
      const plane = current.planes && current.planes[PLANE_TO_TREE[p]];
      const nowDigest = plane ? plane.digest : null;
      if (nowDigest !== planes[p]) {
        results[p] = 'no-verdict';
        reports.push(`endpoint revalidation failed for ${p} — verdict refused, settled no-verdict`);
        continue;
      }
    }
    results[p] = { verdict, digest: planes[p] };
  }
  return results;
}

// ---------------------------------------------------------------------------
// The pairing sweep — the single verdict-writing path for MCP reviews. A
// foreground PostToolUse triggers it; later hook events retry it; stop-guard
// runs it before deriving gates. All appends of one sweep are ONE staged
// commit, ordered so every legal prefix is safe on its own.
// ---------------------------------------------------------------------------

function sweep(repoRoot, { sessionId, transcriptPath, now }) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const { dir, file } = logFileOf(repoRoot);
  const reports = [];
  let tombstonePairs = [];

  const outcome = receiptLog.withFileLock(file, handle => {
    const { records } = receiptLog.readRecords(file);
    const fold = foldRecords(records);
    reports.push(...fold.reports);

    let currentFileId = null;
    try {
      currentFileId = transcriptFileId(transcriptPath);
    } catch {
      reports.push('transcript unreadable — sweep appends nothing (fail-closed)');
      return { ok: false, reports };
    }

    // Cursor: offset + pending set. The pending set is derived from the log
    // (unbound and bound-but-unsettled dispatches), so the effective scan
    // start backtracks to the earliest offset a pending dispatch could still
    // claim from; a lost/invalid cursor costs exactly one full rescan.
    const cursor = readCursor(dir, sessionId, currentFileId);
    const mine = [...fold.dispatches.values()].filter(D => D.sessionId === sessionId);
    let scanStart = cursor ? cursor.offset : 0;
    for (const D of mine) {
      // Backtrack for every nonterminal dispatch, not just unbound ones: a
      // reserved (undisposed) entry protected by a live bound/owned window
      // sits behind the cursor without a disposition, and the advance rule
      // ("everything behind is durably applied or classified no-op") is
      // honoured by re-scanning from the window's start until it settles.
      if (
        (D.state === 'in-flight' || D.state === 'bound' || D.state === 'owned') &&
        D.frontierStart !== null &&
        D.frontierStart < scanStart
      ) {
        scanStart = D.frontierStart;
      }
    }
    const act = validActivation(fold, sessionId, transcriptPath, currentFileId);
    if (act && act.activated_at < scanStart) {
      // Pre-barrier quarantine is idempotent but must be able to SEE the
      // pre-barrier region until every entry there is disposed.
      const frontierListEarly = applicableFrontiers(fold, sessionId, transcriptPath, currentFileId);
      const preBarrierPending = undisposedEntries(
        fold,
        scanTranscript(transcriptPath, 0).entries.filter(e => e.endOffset <= act.activated_at),
        frontierListEarly,
        sessionId,
        currentFileId
      );
      if (preBarrierPending.length > 0) scanStart = 0;
    }

    const scan = scanTranscript(transcriptPath, scanStart);
    const frontierList = applicableFrontiers(fold, sessionId, transcriptPath, currentFileId);
    const pending = undisposedEntries(fold, scan.entries, frontierList, sessionId, currentFileId);
    // Identities the whole scan shows more than once — never bindable, and
    // admitted to no key's closure matching (round 14, conflictedScanIds).
    // A pending entry whose id the ledger already attributed is the same
    // hazard arriving through durable facts (round 15, knownTooluseIds):
    // its original occurrence is suppressed — folded under a frontier or
    // out of scan range — so the copy in front of us is a reused identity.
    const conflictedIds = conflictedScanIds(scan);
    const knownIds = knownTooluseIds(fold, sessionId, currentFileId, frontierList);
    for (const e of pending) {
      if (knownIds.has(e.tooluseId)) conflictedIds.add(e.tooluseId);
    }
    // Full-prefix identity census, lazily once per sweep (round 18): an
    // incremental scan cannot see a non-protocol tool_use behind the
    // cursor — no disposition, bound record, or frontier summarizes those —
    // so the ONLY sound uniqueness statement before an eager bind is a
    // count over the whole file. Computed only when a bind is actually
    // about to happen; when scanStart is 0 the incremental scan already is
    // the census. This cache serves BIND decisions only (round 20):
    // settlement never reads it — consumption re-derives everything from
    // its own fresh snapshot in step 4 below.
    let fullIdCounts = scanStart === 0 ? scan.idCounts : undefined;
    const fullPrefixCount = id => {
      if (fullIdCounts === undefined) {
        try {
          fullIdCounts = scanTranscript(transcriptPath, 0).idCounts;
        } catch {
          fullIdCounts = null;
        }
      }
      return fullIdCounts === null ? null : fullIdCounts.get(id) || 0;
    };
    const time = new Date(nowMs).toISOString();
    const toAppend = [];
    const disposedNow = new Set();
    const settlements = [];

    // One digest-verification memo per lock-held sweep (round 10 P2). Every
    // disposition carries the entry's PARSE-TIME digest (e.rangeDigest,
    // round 11) — the committed proof is byte-identical to what the entry
    // was parsed from, and to what any 2b decision matched, by construction.
    const digestMemo = new Map();

    const quarantine = (e, reason) => {
      if (disposedNow.has(e.tooluseId)) return;
      disposedNow.add(e.tooluseId);
      toAppend.push({
        v: 1,
        kind: 'tooluse_disposition',
        session_id: sessionId,
        key: e.key,
        tooluse_id: e.tooluseId,
        reason,
        transcript_file_id: currentFileId,
        start_offset: e.startOffset,
        end_offset: e.endOffset,
        range_digest: e.rangeDigest,
        time,
      });
    };

    // 1. Pre-barrier wholesale quarantine: never claimable as any call's own.
    if (act) {
      for (const e of pending) {
        if (e.endOffset <= act.activated_at) quarantine(e, 'unaccounted');
      }
    }

    // 2. Expiry retirement: within the retention window, retirement is an
    // `expired` EVENT (in-flight/bound only; a bound dispatch's late result
    // is refused BY NAME below, a never-bound one by disposition exclusion).
    for (const D of mine) {
      if ((D.state === 'in-flight' || D.state === 'bound') && expiredForPairing(D.rec, nowMs)) {
        const ev = { v: 1, kind: 'dispatch_event', dispatch_id: D.id, event: 'expired', time };
        // Window boundaries stop at parsedUpto, never size: a torn tail is
        // unclassified territory and must stay outside every closed window.
        if (!D.boundTooluseId) ev.frontier_end = scan.parsedUpto;
        toAppend.push(ev);
        D.state = 'expired';
        if (!D.boundTooluseId) D.frontierEnd = ev.frontier_end;
        reports.push(`dispatch ${D.id} expired (log-side age)`);
      }
    }

    // 2b. Contested-ack materialization: a never-bound contested dispatch
    // whose window never closed (contested events carry no frontier_end at
    // append time — the calls' own entries have not landed yet — and a
    // read-time-only contest has no event at all) gets one closing ack now,
    // AFTER those entries are inside parsedUpto. "After" is VERIFIED, not
    // assumed: a window sealed before its own entry landed is a window that
    // entry can never pay — the pair's debt would then be structurally
    // unpayable and the key permanently degraded by an ordinary race (one
    // review's PostToolUse sweep firing before the other call's entry is
    // published). So a key's open windows close ALL-OR-NONE, and only when
    // the landed same-key observations can plausibly supply one entry per
    // window — the SAME normalization and matching the hazard ledger uses
    // (addObservation + windowsMatchable, round 8: the rank-count Hall
    // shortcut was only valid for nested same-file intervals, and a
    // divergent observation graph let 2b close windows the hazard check
    // then refused to consider paid). Until then the windows stay open, the
    // hazard stays active, and the next sweep retries — fail-closed, never
    // fail-poisoned. The reducer absorbs a post-terminal contested ack
    // silently; frontierEnd landing makes this idempotent across sweeps.
    {
      // The ephemeral side is normalized GLOBALLY before per-key matching
      // (rounds 13–14, conflictedScanIds): each key builds its own matching
      // graph, but disposal is global by tooluse_id — a reused identity
      // admitted to two keys' graphs would be paid once by the first key
      // processed and skipped by the second's pre-ack loop, closing the
      // second key unpaid forever. A conflicted identity is admitted to NO
      // key — same fail-closed rule addObservation applies within a key.
      const openByKey = new Map();
      for (const D of mine) {
        if (D.state === 'contested' && !D.boundTooluseId && D.frontierEnd === null) {
          if (!openByKey.has(D.key)) openByKey.set(D.key, []);
          openByKey.get(D.key).push(D);
        }
      }
      for (const [key, open] of openByKey) {
        // Prospective close point: parsedUpto — but never past a live
        // UNBOUND same-key dispatch's frontier_start: that range is an open
        // claim window, and a contested window closing over it would steal
        // its own entry. Bound/owned dispatches have consumed a specific
        // identity and claim nothing new — clamping on them would collapse
        // this window to empty and misfile its entries as `unaccounted`.
        let end = scan.parsedUpto;
        const sk2 = `${sessionId}\u0000${key}`;
        for (const oid of fold.bySessionKey.get(sk2) || []) {
          const O = fold.dispatches.get(oid);
          if (O && O.state === 'in-flight' && O.frontierStart !== null && O.frontierStart < end) {
            end = O.frontierStart;
          }
        }
        const endOf = D =>
          D.frontierStart !== null && end < D.frontierStart ? D.frontierStart : end;
        // Landed observations: every same-key entry whose offsets are known
        // — still-pending scan entries, and entries already disposed (their
        // dispositions carry offsets), including this sweep's own step-1
        // quarantines. Normalized exactly as the hazard matcher normalizes
        // payments: offset-less records prove nothing, an exact duplicate is
        // one observation, conflicting copies prove nothing — fail-closed.
        const obs = new Map();
        for (const e of pending) {
          if (e.key !== key || conflictedIds.has(e.tooluseId)) continue;
          // A scan entry observes with its PARSE-TIME digest (round 11) —
          // the proof born with the parsed bytes, never a later re-read
          // that could hash a rewrite's replacement under this entry's
          // metadata. verifiedObservations then requires that digest to
          // recompute over the CURRENT bytes at the decision: a rewrite
          // between parse and decision fails the check, the observation is
          // refused, and the window holds open — fail-closed.
          // The ephemeral side is the PENDING set, never the raw scan
          // (round 12): an entry suppressed by a foreign-key disposition
          // can never receive a same-key payment, so admitting it would
          // close windows 3b could never clear — every ephemeral
          // observation admitted here is either quarantined pre-ack below
          // or already durable via takeDisposition.
          addObservation(obs, currentFileId, e.tooluseId, e.startOffset, e.endOffset, e.rangeDigest);
        }
        const takeDisposition = d => {
          if (d.key !== key || d.session_id !== sessionId) return;
          addObservation(obs, d.transcript_file_id, d.tooluse_id, d.start_offset, d.end_offset, d.range_digest);
        };
        for (const d of fold.dispositions) takeDisposition(d);
        for (const r of toAppend) {
          if (r.kind === 'tooluse_disposition') takeDisposition(r);
        }
        const obsList = verifiedObservations(obs, currentFileId, transcriptPath, digestMemo);
        const windowOk = D => windowAnchorVerifies(D, currentFileId, transcriptPath, digestMemo);
        const satisfiable = windowsMatchable(open, obsList, endOf, windowOk);
        if (!satisfiable) {
          reports.push(
            `contested windows for key ${String(key).slice(0, 24)}… held open — landed entries cannot yet supply one per window`
          );
          continue;
        }
        // Durable payments PRECEDE the closing acks in append order
        // (round 11 P1): one lock hold persists any PREFIX (§3.3), and an
        // acknowledgement-only prefix would close windows whose paying
        // dispositions never landed — a rewrite before the retry could then
        // strand them closed-and-unpaid forever. A disposition-only prefix
        // is retry-safe: the windows simply stay open and the next sweep
        // re-decides. Every still-pending entry inside a closing window is
        // strictly below each live unbound frontier (the clamp above), so
        // no live dispatch could ever claim it — disposing it here steals
        // nothing.
        for (const e of pending) {
          if (e.key !== key || conflictedIds.has(e.tooluseId) || disposedNow.has(e.tooluseId)) {
            continue;
          }
          const inClosing = open.some(
            D => D.frontierStart !== null && e.startOffset >= D.frontierStart && e.endOffset <= endOf(D)
          );
          if (inClosing) quarantine(e, 'contested');
        }
        for (const D of open) {
          const e2 = endOf(D);
          toAppend.push({
            v: 1,
            kind: 'dispatch_event',
            dispatch_id: D.id,
            event: 'contested',
            frontier_end: e2,
            time,
          });
          D.frontierEnd = e2;
          D.hasContestedAck = true;
          reports.push(`contested ack materialized for ${D.id} (window closed at ${e2})`);
        }
      }
    }

    // 3. Accounting: terminal never-bound windows quarantine their unclaimed
    // candidate; a frontier-only in-flight dispatch that now sees a
    // below-capture orphan poisons `ambiguous`; then eager binding.
    const byKey = new Map();
    for (const e of pending) {
      if (disposedNow.has(e.tooluseId)) continue;
      if (!byKey.has(e.key)) byKey.set(e.key, []);
      byKey.get(e.key).push(e);
    }
    for (const [key, entries] of byKey) {
      entries.sort((a, b) => a.startOffset - b.startOffset);
      const sk = `${sessionId}\u0000${key}`;
      const group = (fold.bySessionKey.get(sk) || []).map(id => fold.dispatches.get(id)).filter(Boolean);
      const liveFrontierOnly = group.filter(D => D.state === 'in-flight' && D.frontierStart !== null);
      const newest = entries[entries.length - 1];

      // Terminal windows first (the round-10 regression: a stale entry with
      // stale PASS output must be quarantined BEFORE any new bind).
      for (const D of group) {
        if (!TERMINAL_STATES.has(D.state) || D.boundTooluseId) continue;
        if (D.frontierStart === null || D.frontierEnd === null) continue;
        for (const e of entries) {
          if (disposedNow.has(e.tooluseId)) continue;
          if (e.startOffset >= D.frontierStart && e.endOffset <= D.frontierEnd) {
            quarantine(e, D.state === 'contested' ? 'contested' : 'unaccounted');
          }
        }
      }

      // Ambiguity: an entry below a frontier-only dispatch's capture point
      // that survived the precondition cannot be that call's own.
      for (const D of liveFrontierOnly) {
        const orphan = entries.find(
          e =>
            !disposedNow.has(e.tooluseId) &&
            e.endOffset <= D.frontierStart &&
            (!act || e.endOffset > act.activated_at)
        );
        if (orphan) {
          toAppend.push({
            v: 1,
            kind: 'dispatch_event',
            dispatch_id: D.id,
            event: 'ambiguous',
            frontier_end: scan.parsedUpto,
            time,
          });
          D.state = 'ambiguous';
          D.frontierEnd = scan.parsedUpto;
          quarantine(orphan, 'unaccounted');
          reports.push(`orphan below capture point — ${D.id} poisoned ambiguous, entry quarantined`);
        }
      }

      // Eager binding: the FIRST same-key entry at-or-past frontier_start;
      // a second in-window candidate refuses (report, no bind). The premise
      // is the same as capture's — "a post-boundary entry can only be this
      // call's own" — so it is subject to the same hazard ledger: a
      // straggler owed by an unpaid terminal never-bound window may land
      // AFTER this dispatch's frontier_start and be indistinguishable from
      // its own entry. On an active hazard: quarantine the candidates and
      // poison the dispatch, never bind. Evaluated here, after the
      // quarantine loops above, so their dispositions count as payments.
      const keyHazard = keyHazardActive(
        fold,
        sk,
        sessionId,
        key,
        currentFileId,
        transcriptPath,
        frontierList,
        toAppend,
        digestMemo
      );
      for (const D of group) {
        if (D.state !== 'in-flight' || D.frontierStart === null) continue;
        const candidates = entries.filter(
          e => !disposedNow.has(e.tooluseId) && e.startOffset >= D.frontierStart
        );
        if (candidates.length === 0) continue;
        if (keyHazard) {
          for (const e of candidates) quarantine(e, 'unaccounted');
          toAppend.push({
            v: 1,
            kind: 'dispatch_event',
            dispatch_id: D.id,
            event: 'ambiguous',
            frontier_end: scan.parsedUpto,
            time,
          });
          D.state = 'ambiguous';
          D.frontierEnd = scan.parsedUpto;
          reports.push(
            `hazard active on this key — ${candidates.length} post-boundary candidate(s) quarantined, ${D.id} poisoned ambiguous instead of binding`
          );
          continue;
        }
        if (candidates.some(e => conflictedIds.has(e.tooluseId))) {
          // A candidate whose identity appears elsewhere in the transcript
          // is unattributable (round 14): binding any remaining candidate
          // would assume the conflicted copy was not this dispatch's own,
          // and settlement pairs results by exactly this identity.
          for (const e of candidates) quarantine(e, 'unaccounted');
          toAppend.push({
            v: 1,
            kind: 'dispatch_event',
            dispatch_id: D.id,
            event: 'ambiguous',
            frontier_end: scan.parsedUpto,
            time,
          });
          D.state = 'ambiguous';
          D.frontierEnd = scan.parsedUpto;
          reports.push(
            `tooluse identity reused across the transcript — ${candidates.length} candidate(s) quarantined, ${D.id} poisoned ambiguous instead of binding`
          );
          continue;
        }
        if (candidates.length === 1) {
          const census = fullPrefixCount(candidates[0].tooluseId);
          if (census === null) {
            reports.push(
              `full-prefix census unavailable — bind of ${candidates[0].tooluseId} deferred for ${D.id}`
            );
            continue;
          }
          if (census !== 1) {
            quarantine(candidates[0], 'unaccounted');
            toAppend.push({
              v: 1,
              kind: 'dispatch_event',
              dispatch_id: D.id,
              event: 'ambiguous',
              frontier_end: scan.parsedUpto,
              time,
            });
            D.state = 'ambiguous';
            D.frontierEnd = scan.parsedUpto;
            reports.push(
              `tooluse identity ${candidates[0].tooluseId} occurs ${census} times in the full transcript — quarantined, ${D.id} poisoned ambiguous instead of binding`
            );
            continue;
          }
          toAppend.push({
            v: 1,
            kind: 'dispatch_event',
            dispatch_id: D.id,
            event: 'bound',
            tooluse_id: candidates[0].tooluseId,
            // Content proof of the bound entry (round 17): the eager-bound
            // entry lies OUTSIDE the dispatch prefix the frontier_digest
            // anchors, so its own bytes must be provable at settlement.
            start_offset: candidates[0].startOffset,
            end_offset: candidates[0].endOffset,
            range_digest: candidates[0].rangeDigest,
            time,
          });
          D.state = 'bound';
          D.boundTooluseId = candidates[0].tooluseId;
          D.boundStart = candidates[0].startOffset;
          D.boundEnd = candidates[0].endOffset;
          D.boundDigest = candidates[0].rangeDigest;
          disposedNow.add(candidates[0].tooluseId); // bound IS the disposition
        } else {
          reports.push(`${candidates.length} in-window candidates for ${D.id} — refusing to bind`);
        }
      }

      // Universal disposition: what no live window can claim and no
      // reservation protects is quarantined. The newest same-key undisposed
      // entry stays reserved while any live dispatch could still claim it.
      // anyLive is computed HERE, after the poisoning loops above — a
      // dispatch they just turned terminal must not reserve anything.
      const anyLive = group.some(D => !TERMINAL_STATES.has(D.state));
      for (const e of entries) {
        if (disposedNow.has(e.tooluseId)) continue;
        const claimable = liveFrontierOnly.some(
          D => D.state === 'in-flight' && e.startOffset >= D.frontierStart
        );
        const reserved = anyLive && e === newest;
        if (claimable || reserved) continue;
        const contestedWindow = group.some(
          D =>
            D.state === 'contested' &&
            D.frontierStart !== null &&
            e.startOffset >= D.frontierStart &&
            (D.frontierEnd === null || e.endOffset <= D.frontierEnd)
        );
        quarantine(e, contestedWindow ? 'contested' : 'unaccounted');
      }
    }

    // 3b. Durable ledger balance: once every never-bound window of a key is
    // paid (and no invalid same-key frontier stands), that balance is
    // persisted as one `debt_cleared` event per owing dispatch. Without it
    // the balance lives only in the paying dispositions, and compaction
    // folding those into a frontier would re-arm the hazard and permanently
    // poison a key that had genuinely recovered — a retained never-bound
    // record must not out-live the proof that its debt was paid. Runs after
    // the accounting loops so this sweep's own quarantines count as
    // payments; keys without pending entries this sweep are still swept, so
    // a balance reached earlier is persisted at the next sweep regardless.
    {
      const clearedKeys = new Set();
      for (const D of mine) {
        if (clearedKeys.has(D.key)) continue;
        clearedKeys.add(D.key);
        const skb = sessionId + String.fromCharCode(0) + D.key;
        const groupB = (fold.bySessionKey.get(skb) || [])
          .map(id => fold.dispatches.get(id))
          .filter(Boolean);
        const owing = owingDispatches(groupB);
        if (owing.length === 0) continue;
        if (keyHazardActive(fold, skb, sessionId, D.key, currentFileId, transcriptPath, frontierList, toAppend, digestMemo)) {
          continue;
        }
        for (const T of owing) {
          toAppend.push({
            v: 1,
            kind: 'dispatch_event',
            dispatch_id: T.id,
            event: 'debt_cleared',
            time,
          });
          T.debtCleared = true;
        }
        reports.push(
          `debt cleared for ${owing.length} never-bound dispatch(es) on key ${String(D.key).slice(0, 24)}…`
        );
      }
    }

    // 4. Settlement: a completion whose id matches a bound (or task-owned),
    // un-contested, un-expired dispatch with an un-spent identity → ONE
    // settlement line. Contested refusal is loud; a spent identity is never
    // consumed twice on any path.
    //
    // Settlement evidence is CONSUMPTION-FRESH (round 20): the bind-time
    // census above is sweep-scoped, so a rewrite landing between step 3 and
    // this loop could otherwise settle against a count that was true when
    // taken and false now. Every settlement decision therefore derives ALL
    // its evidence — identity census, bound-entry bytes, and the consumed
    // completion — from ONE full-transcript snapshot taken here, at
    // consumption, in a single buffered read: the pieces cannot disagree
    // with each other. The snapshot self-certifies (selfDigest), and its
    // continued validity is re-checked against the live file immediately
    // before the settlement batch commits; a transcript that changed in the
    // window drops the whole batch (deferred, never mis-settled). The
    // residual instant between that check and the append is the irreducible
    // race every content check here carries — the transcript is not under
    // this lock.
    let settleSnap;
    const settlementSnapshot = () => {
      if (settleSnap === undefined) {
        try {
          settleSnap = scanTranscript(transcriptPath, 0, { selfDigest: true });
        } catch {
          settleSnap = null;
        }
      }
      return settleSnap;
    };
    // The round-17 content proof, taken against the snapshot instead of a
    // second live read: the bound entry must appear in the snapshot as a
    // protocol entry at the recorded offsets with the recorded parse-time
    // digest. Absent proof fields (legacy or crafted records) fail closed.
    const snapBoundEntryOk = (snap, D) =>
      D.rec.transcript_file_id === currentFileId &&
      Number.isInteger(D.boundStart) &&
      Number.isInteger(D.boundEnd) &&
      D.boundStart >= 0 &&
      D.boundEnd > D.boundStart &&
      typeof D.boundDigest === 'string' &&
      D.boundDigest.length > 0 &&
      snap.entries.some(
        e =>
          e.tooluseId === D.boundTooluseId &&
          e.startOffset === D.boundStart &&
          e.endOffset === D.boundEnd &&
          e.rangeDigest === D.boundDigest
      );
    // settlement record -> the state it settled FROM, so the pre-commit
    // validity gate can revert a dropped batch in-memory without guessing.
    const settledPrior = new Map();
    for (const D of mine) {
      let completion = null;
      let completionId = null;
      if (D.state === 'owned') {
        // A task-owned dispatch pairs ONLY with its own task's completion —
        // its foreground tool_result is the handoff placeholder, never the
        // report. The grant verified the bound entry's content proof; it
        // must STILL verify here (round 18) — a rebuild between grant and
        // task completion severs the attribution the grant stood on.
        if (D.ownedTaskId && scan.tasks.has(D.ownedTaskId)) {
          const snap = settlementSnapshot();
          if (snap === null) {
            reports.push(`settlement snapshot unavailable — settlement of ${D.id} deferred`);
            continue;
          }
          if (!snapBoundEntryOk(snap, D)) {
            reports.push(
              `settlement refused: bound entry of owned ${D.id} unverifiable against the current transcript`
            );
            continue;
          }
          // Uniqueness must hold AT CONSUMPTION, over the whole file
          // (rounds 19–20): a rewrite below the frontier can mint a
          // duplicate the incremental scan never sees, with the bound bytes
          // intact — counted on the settlement snapshot, never a bind-time
          // cache.
          const ownedCensus = snap.idCounts.get(D.boundTooluseId) || 0;
          if (ownedCensus !== 1) {
            reports.push(
              `settlement refused: bound identity ${D.boundTooluseId} occurs ${ownedCensus} times in the full transcript (${D.id})`
            );
            continue;
          }
          const t = snap.tasks.get(D.ownedTaskId);
          if (!t) {
            reports.push(
              `settlement deferred: task ${D.ownedTaskId} not present in the settlement snapshot (${D.id})`
            );
            continue;
          }
          completion = t;
          completionId = `task:${D.ownedTaskId}`;
        }
      } else if (D.boundTooluseId && scan.results.has(D.boundTooluseId)) {
        // Binding proved the identity was a singleton AT BIND TIME;
        // settlement consumes it later, and a transcript that has since
        // grown a second entry with this id makes results.get(id) attribute
        // an arbitrary one of two calls (round 15). Refuse — the dispatch
        // stays bound and expiry retires it: one wasted review, never a
        // receipt minted from another request's completion.
        //
        // Two detectors, split by bind kind (round 16). An eager-bound
        // entry sits at/past frontier_start, and scanStart backtracks to
        // frontier_start while the dispatch is unsettled, so the own entry
        // is ALWAYS in scan — any reuse makes two occurrences and lands in
        // conflictedIds. A capture-bound entry ends AT OR BELOW
        // frontier_start and can fall below scanStart once the cursor
        // advances; its reuse then scans as an innocent singleton — but a
        // scan entry bearing a capture-bound identity past frontier_start
        // is positionally impossible as the own entry, so its existence IS
        // the conflict (null frontier_start: any occurrence refuses,
        // fail-closed).
        // The reuse test spans ALL tool_use blocks, not just protocol
        // entries (round 18) — a non-review call reusing the bound id past
        // the boundary poisons attribution identically.
        const captureReuse =
          D.bornBound &&
          (D.frontierStart === null ||
            (scan.idMaxEnd.get(D.boundTooluseId) || -1) > D.frontierStart);
        if (conflictedIds.has(D.boundTooluseId) || captureReuse) {
          reports.push(
            `settlement refused: bound identity ${D.boundTooluseId} reused across the transcript (${D.id})`
          );
          continue;
        }
        // The scan-side detectors above only see the id namespace; the
        // bytes themselves are proven here (rounds 17, 20): the bound entry
        // must still exist with the digest recorded at bind time, the
        // identity must be a singleton over the WHOLE file, and the
        // consumed result must have landed AFTER both the dispatch
        // boundary and the bound entry — all read from the settlement
        // snapshot, so a pre-dispatch stray result, a rebuild's replacement
        // bytes, or a mid-sweep rewrite can never mint this receipt.
        const snap = settlementSnapshot();
        if (snap === null) {
          reports.push(`settlement snapshot unavailable — settlement of ${D.id} deferred`);
          continue;
        }
        if (!snapBoundEntryOk(snap, D)) {
          reports.push(
            `settlement refused: bound entry of ${D.id} unverifiable against the current transcript`
          );
          continue;
        }
        const census = snap.idCounts.get(D.boundTooluseId) || 0;
        if (census !== 1) {
          reports.push(
            `settlement refused: bound identity ${D.boundTooluseId} occurs ${census} times in the full transcript (${D.id})`
          );
          continue;
        }
        const r0 = snap.results.get(D.boundTooluseId);
        if (!r0) {
          reports.push(
            `settlement deferred: result for ${D.boundTooluseId} not present in the settlement snapshot (${D.id})`
          );
          continue;
        }
        if (
          D.frontierStart === null ||
          r0.endOffset <= D.frontierStart ||
          r0.endOffset <= D.boundEnd
        ) {
          reports.push(
            `settlement refused: result for ${D.boundTooluseId} precedes the dispatch boundary or its bound entry (${D.id})`
          );
          continue;
        }
        // The handoff placeholder is a promise, not a completion: leave the
        // dispatch bound so the `owned` marking (and later the task's own
        // report) can reach it. If ownership never lands, expiry retires it —
        // fail-closed, never a placeholder-settled no-verdict.
        if (!outputIsBackgroundHandoff(r0.text)) {
          completion = r0;
          completionId = `tooluse:${D.boundTooluseId}`;
        }
      }
      if (!completion) continue;
      if (fold.spent.has(completionId)) {
        if (D.state !== 'settled') {
          reports.push(`completion ${completionId} already spent — refused for ${D.id}`);
        }
        continue;
      }
      if (D.state === 'contested') {
        reports.push(`completion ${completionId} refused: dispatch ${D.id} contested`);
        continue;
      }
      if (TERMINAL_STATES.has(D.state)) {
        reports.push(`completion ${completionId} refused: dispatch ${D.id} is ${D.state}`);
        continue;
      }
      if (expiredForPairing(D.rec, nowMs)) {
        reports.push(`completion ${completionId} refused by name: dispatch ${D.id} expired`);
        continue;
      }
      if (D.state !== 'bound' && D.state !== 'owned') continue;
      const planeResults = buildPlaneResults(D.planes, completion.text, repoRoot, reports);
      // §4 producer duty: a PASS record resolves the tombstones standing
      // against its own (plane, digest) pairs — and the resolves array is
      // written only after ACTUALLY reading the fallback. The runner already
      // does this for its verdict rows; a sweep settlement is the same kind of
      // primary PASS and owes the same resolution, or a settlement-closed gate
      // stays vetoed forever (its tombstone never clears). A damaged fallback
      // read attaches nothing: unreadable means unresolved-for-every-pair, and
      // minting resolves from a read we could not trust would fail open.
      let resolves;
      const passPairs = Object.entries(planeResults).filter(
        ([, proj]) => proj && typeof proj === 'object' && proj.verdict === 'pass' && proj.digest
      );
      if (passPairs.length > 0) {
        const ts = receiptLog.readTombstones(repoRoot);
        if (ts.ok) {
          const tuples = [];
          for (const [plane, proj] of passPairs) {
            for (const id of receiptLog.matchingTombstoneIds(ts.records, plane, proj.digest)) {
              tuples.push({ plane, digest: proj.digest, id });
            }
          }
          if (tuples.length > 0) resolves = tuples;
        } else {
          reports.push(
            `tombstone fallback unreadable at settlement (${ts.reason || 'unknown'}) — no resolves attached`
          );
        }
      }
      const settlement = {
        v: 1,
        kind: 'settlement',
        dispatch_id: D.id,
        completion_id: completionId,
        plane_results: planeResults,
        ...(resolves ? { resolves } : {}),
        time,
      };
      toAppend.push(settlement);
      settlements.push(settlement);
      settledPrior.set(settlement, { D, prior: D.state });
      fold.spent.add(completionId);
      D.state = 'settled';
      D.settlement = settlement;
    }

    // Snapshot validity gate (round 20): every settlement above was decided
    // against settleSnap's bytes. If the live transcript no longer carries
    // those exact bytes, the evidence is no longer true — drop the whole
    // settlement batch (dispatches revert to bound/owned; a later sweep
    // retries against the file as it is then) and commit the rest. Growth
    // past the snapshot is fine: only the read prefix must be intact.
    if (settlements.length > 0 && settleSnap) {
      let live = null;
      try {
        live = prefixDigest(transcriptPath, settleSnap.selfDigestUpto);
      } catch {
        live = null;
      }
      if (live !== settleSnap.selfDigest) {
        const dropped = new Set(settlements);
        for (let i = toAppend.length - 1; i >= 0; i--) {
          if (dropped.has(toAppend[i])) toAppend.splice(i, 1);
        }
        for (const s of settlements) {
          fold.spent.delete(s.completion_id);
          const undo = settledPrior.get(s);
          if (undo && undo.D.settlement === s) {
            undo.D.state = undo.prior;
            undo.D.settlement = null;
          }
        }
        reports.push(
          `settlement batch dropped: transcript changed between snapshot and commit (${settlements.length} deferred)`
        );
        settlements.length = 0;
      }
    }

    if (toAppend.length > 0) {
      try {
        receiptLog.stageAndCommit(file, handle, toAppend);
      } catch (e) {
        // Settlement append failure → one crash-atomic batch tombstone,
        // verdict-bearing pairs only, written OUTSIDE this lock (no path
        // ever holds both locks at once).
        for (const s of settlements) {
          for (const [plane, proj] of Object.entries(s.plane_results)) {
            if (proj && typeof proj === 'object' && proj.verdict) {
              tombstonePairs.push({ plane, digest: proj.digest });
            }
          }
        }
        reports.push(`sweep append failed: ${String(e.message)}`);
        return { ok: false, reports };
      }
    }

    // Cursor advances only after every event behind it is durably applied or
    // durably classified no-op — which the commit above just made true. It
    // stops at parsedUpto: a torn tail was neither applied nor classified,
    // and the completed line must be re-read once the write finishes.
    writeCursor(dir, sessionId, {
      v: 1,
      session_id: sessionId,
      transcript_file_id: currentFileId,
      offset: scan.parsedUpto,
    });
    return {
      ok: true,
      appended: toAppend.length,
      settled: settlements.length,
      reports,
    };
  });

  if (tombstonePairs.length > 0) {
    try {
      receiptLog.appendTombstone(repoRoot, tombstonePairs);
      reports.push(`batch tombstone written for ${tombstonePairs.length} pair(s)`);
    } catch (e) {
      reports.push(`CRITICAL: tombstone write also failed: ${String(e.message)}`);
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Compaction: fold aged dispositions into a monotonically-advancing frontier
// (write-ahead: the frontier line lands and syncs BEFORE any disposition it
// covers is dropped), and drop >48h dispatch records only under the
// contested-materialization duty — a record drop must never change any
// survivor's fold (§3.3).
// ---------------------------------------------------------------------------

function compactDispatchRecords(repoRoot, { sessionId, transcriptPath, now }) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const { file } = logFileOf(repoRoot);
  return receiptLog.withFileLock(file, handle => {
    const { records } = receiptLog.readRecords(file);
    const fold = foldRecords(records);
    const reports = [];

    let currentFileId = null;
    let scan = null;
    try {
      currentFileId = transcriptFileId(transcriptPath);
      scan = scanTranscript(transcriptPath, 0);
    } catch {
      /* no scannable transcript: no frontier folding AND no drops below */
    }

    // Drop candidates first — Phase 1 needs their keys. Four restrictions,
    // each fail-closed:
    //  - agedForRetention, never expiredForPairing: a malformed/future stamp
    //    is excluded from pairing but RETAINED (§3.4 "retained for
    //    exclusion") — deletion needs a valid stamp that genuinely aged;
    //  - scoped to THIS session and THIS transcript file (or a record that
    //    never named one): another session's fold, or this session against a
    //    rotated file, cannot be re-derived here, so its records keep their
    //    exclusion duty;
    //  - no scannable transcript → no drops at all: coverage below is
    //    unverifiable, and a blind drop re-admits whatever the record
    //    excluded;
    //  - NEVER-BOUND terminal dispatches are retained permanently: each one
    //    is the capture hazard rule's evidence that its own entry may still
    //    arrive unaccounted, and no frontier can cover an entry that has not
    //    landed yet. One JSONL line forever is the price of never guessing.
    const dropDispatchIds = new Set();
    if (scan) {
      for (const D of fold.dispatches.values()) {
        if (D.sessionId !== sessionId) continue;
        if (!D.boundTooluseId) continue; // never-bound → hazard evidence, kept
        const fid = D.rec.transcript_file_id;
        if (fid !== currentFileId && fid !== null && fid !== undefined) continue;
        if (agedForRetention(D.rec, nowMs) && TERMINAL_STATES.has(D.state)) {
          dropDispatchIds.add(D.id);
        }
      }
    } else {
      reports.push('transcript unscannable — compaction drops nothing (fail-closed)');
    }

    // Phase 1 (write-ahead): fold aged dispositions into frontier records.
    // Contiguity: the frontier advances only over a prefix in which every
    // same-key entry is terminally disposed — never past an undisposed one.
    //
    // UNCLEARED keys keep their dispositions. A disposition on a key with an
    // un-cleared never-bound debt is live ledger evidence twice over: sweep
    // 2b counts it as a landed observation when deciding whether the key's
    // open contested windows may close, and `keyHazardActive` counts it as a
    // payment against a closed window until the balance is persisted as
    // `debt_cleared`. Folding it into a frontier deletes the offsets both
    // readings need — the open-window case would deadlock the key forever
    // (the entry is below every later scanStart, so nothing can ever
    // re-observe it), and the closed-window case would re-arm a paid debt
    // (a crash before any sweep runs leaves capture-path payments
    // unclear-ed). Retained until clearance; the next compaction after
    // `debt_cleared` folds them normally. Honest cost: a key whose debt is
    // PERMANENTLY unpayable (an open or empty window) never clears, so its
    // dispositions are retained forever and every same-key retry adds one
    // ambiguous dispatch plus its quarantine records — the log grows per
    // retry on a degraded key, loudly, for as long as the caller keeps
    // retrying it. The hazard is scoped to (session, key), so the
    // operational degradation dies with the session; only the storage
    // lines persist.
    const unclearedKeys = new Set();
    for (const D of fold.dispatches.values()) {
      if (D.sessionId !== sessionId) continue;
      if (TERMINAL_STATES.has(D.state) && !D.boundTooluseId && !D.debtCleared) {
        unclearedKeys.add(D.key);
      }
    }
    const frontierAppends = [];
    const coveredDispositions = new Set();
    if (scan) {
      const aged = fold.dispositions.filter(
        d => d.session_id === sessionId && agedForRetention(d, nowMs)
      );
      const byKey = new Map();
      for (const d of aged) {
        if (!byKey.has(d.key)) byKey.set(d.key, []);
        byKey.get(d.key).push(d);
      }
      // A drop candidate accounted by identity (bound) must have its entry
      // frontier-covered before the dispatch record disappears — otherwise a
      // rescan re-admits that entry as unaccounted. Fold those keys too,
      // even when no aged disposition names them.
      for (const id of dropDispatchIds) {
        const D = fold.dispatches.get(id);
        if (D && D.boundTooluseId && !byKey.has(D.key)) byKey.set(D.key, []);
      }
      for (const [key, ds] of byKey) {
        // The contiguity proof is scoped to THIS session and THIS transcript
        // file: a tooluse_id reused by another session — or by this session
        // against a rebuilt/forked file — is not evidence that the entry in
        // the CURRENT file was ever disposed, and a frontier advanced on it
        // would exclude an entry nothing accounted for (fail-open). A
        // disposition without a matching transcript_file_id proves nothing
        // here and neither folds nor advances anything.
        const disposedIds = new Set(
          fold.dispositions
            .filter(x => x.key === key && x.session_id === sessionId && x.transcript_file_id === currentFileId)
            .map(x => x.tooluse_id)
        );
        for (const D of fold.dispatches.values()) {
          if (
            D.key === key &&
            D.boundTooluseId &&
            D.sessionId === sessionId &&
            D.rec.transcript_file_id === currentFileId
          ) {
            disposedIds.add(D.boundTooluseId);
          }
        }
        const keyEntries = scan.entries.filter(e => e.key === key).sort((a, b) => a.startOffset - b.startOffset);
        let uptoEnd = 0;
        for (const e of keyEntries) {
          if (!disposedIds.has(e.tooluseId)) break; // contiguity stops at the first undisposed entry
          uptoEnd = e.endOffset;
        }
        if (uptoEnd === 0) continue;
        const pd = prefixDigest(transcriptPath, uptoEnd);
        if (!pd) continue;
        // The folded ids ride the frontier (round 15): the dispositions
        // about to be deleted are the only durable record that these
        // identities were ever attributed, and knownTooluseIds needs that
        // fact to refuse a post-compaction reuse of the same id.
        const coveredIds = [];
        {
          const seenIds = new Set();
          for (const e of keyEntries) {
            if (e.endOffset > uptoEnd) break;
            if (!seenIds.has(e.tooluseId)) {
              seenIds.add(e.tooluseId);
              coveredIds.push(e.tooluseId);
            }
          }
        }
        // Positional equality is NOT duplication (round 16): the deletion
        // below is licensed by the frontier carrying the folded identities,
        // so a same-coordinates frontier whose validated tooluse_ids does
        // not cover every id being folded — legacy field-less, malformed,
        // or partial — must not suppress the upgraded append. Two
        // same-coordinate frontiers are redundant and consistent, never a
        // gap; suppressing the richer one loses the only identity summary
        // that outlives the dispositions.
        const dup = fold.frontiers.some(f => {
          if (
            f.session_id !== sessionId ||
            f.key !== key ||
            f.transcript_file_id !== currentFileId ||
            f.upto_end !== uptoEnd ||
            f.prefix_digest !== pd
          ) {
            return false;
          }
          const have = new Set(validTooluseIds(f));
          return coveredIds.every(id => have.has(id));
        });
        if (!dup) {
          frontierAppends.push({
            v: 1,
            kind: 'frontier',
            session_id: sessionId,
            key,
            transcript_file_id: currentFileId,
            upto_end: uptoEnd,
            prefix_digest: pd,
            tooluse_ids: coveredIds,
            time: new Date(nowMs).toISOString(),
          });
        }
        for (const d of ds) {
          if (unclearedKeys.has(d.key)) continue; // live ledger evidence — retained
          // Only a disposition for THIS transcript file is covered by a
          // frontier over this file — a foreign file's disposition whose
          // numeric end_offset happens to fit is that file's only exclusion
          // evidence, and deleting it would re-admit its entry there.
          if (d.transcript_file_id !== currentFileId) continue;
          if (typeof d.end_offset === 'number' && d.end_offset <= uptoEnd) {
            coveredDispositions.add(d);
          }
        }
      }
      if (frontierAppends.length > 0) {
        receiptLog.stageAndCommit(file, handle, frontierAppends);
      }
    }

    // Coverage duty: a bound drop candidate stays unless its entry is
    // covered by a frontier that verifies right now (existing-applicable or
    // just written). The just-written ones are re-verified here too — the
    // transcript is NOT under this lock, so it may have been rebuilt between
    // their prefixDigest computation and this destructive decision. An entry
    // missing from the scan is NOT proof it is gone — retained, fail-closed.
    if (scan) {
      const coverage = [
        ...applicableFrontiers(fold, sessionId, transcriptPath, currentFileId),
        ...frontierAppends.filter(
          f => prefixDigest(transcriptPath, f.upto_end) === f.prefix_digest
        ),
      ];
      const entryById = new Map(scan.entries.map(e => [e.tooluseId, e]));
      for (const id of [...dropDispatchIds]) {
        const D = fold.dispatches.get(id);
        if (!D || !D.boundTooluseId) continue;
        const e = entryById.get(D.boundTooluseId);
        const covered = e
          ? coverage.some(f => f.key === D.key && e.endOffset <= f.upto_end)
          : false;
        if (!covered) {
          dropDispatchIds.delete(id);
          reports.push(`bound entry of ${id} not frontier-covered — record retained`);
        }
      }
    }

    // Phase 2: materialize contested acknowledgments for survivors of any
    // derived contest whose other member is about to be dropped.
    const acks = [];
    for (const D of fold.dispatches.values()) {
      if (!dropDispatchIds.has(D.id) || D.state !== 'contested') continue;
      const sk = `${D.sessionId}\u0000${D.key}`;
      for (const otherId of fold.bySessionKey.get(sk) || []) {
        if (otherId === D.id || dropDispatchIds.has(otherId)) continue;
        const S = fold.dispatches.get(otherId);
        if (S && S.state === 'contested') {
          acks.push({
            v: 1,
            kind: 'dispatch_event',
            dispatch_id: S.id,
            event: 'contested',
            time: new Date(nowMs).toISOString(),
          });
          reports.push(`materialized contested ack for survivor ${S.id} before dropping ${D.id}`);
        }
      }
    }
    if (acks.length > 0) {
      receiptLog.stageAndCommit(file, handle, acks);
    }

    // seq_hwm write-ahead: a dropped dispatch record takes its seq out of
    // the fold, and the allocator would mint it again. The floor lands
    // durably BEFORE any record it stands in for disappears.
    let maxDroppedSeq = fold.seqHwm.get(sessionId) || 0;
    for (const id of dropDispatchIds) {
      const D = fold.dispatches.get(id);
      if (D && typeof D.rec.seq === 'number' && D.rec.seq > maxDroppedSeq) {
        maxDroppedSeq = D.rec.seq;
      }
    }
    if (maxDroppedSeq > (fold.seqHwm.get(sessionId) || 0)) {
      receiptLog.stageAndCommit(file, handle, [
        {
          v: 1,
          kind: 'seq_hwm',
          session_id: sessionId,
          seq: maxDroppedSeq,
          time: new Date(nowMs).toISOString(),
        },
      ]);
    }

    // Phase 3: rewrite without the dropped records. Settlements are the
    // spent-identity ledger and are never dropped here; frontier and
    // activation records are liveness-retained, never aged. The re-read after
    // the write-ahead appends yields fresh objects, so covered dispositions
    // are matched by content, never by reference. Superseded seq_hwm records
    // (a lower floor for the same session) collapse into the highest one.
    // The content identity carries the FULL scope — session, file, offsets —
    // so a same-named record from another session or transcript file can
    // never be deleted by collision (its own file's exclusion evidence).
    // Length-delimited (JSON), so no field's content can alias the joiner.
    const dispositionIdentity = d =>
      JSON.stringify([d.session_id, d.transcript_file_id, d.tooluse_id, d.key, d.start_offset, d.end_offset, d.time]);
    const coveredIds = new Set([...coveredDispositions].map(dispositionIdentity));
    const { records: fresh } = receiptLog.readRecords(file);
    const hwmMax = new Map();
    for (const r of fresh) {
      if (r && r.kind === 'seq_hwm' && typeof r.seq === 'number') {
        if (r.seq > (hwmMax.get(r.session_id) || 0)) hwmMax.set(r.session_id, r.seq);
      }
    }
    const hwmKeptFor = new Set();
    const kept = fresh.filter(r => {
      if (!r || typeof r !== 'object') return false;
      if (r.kind === 'dispatch' || r.kind === 'dispatch_event') {
        return !dropDispatchIds.has(r.dispatch_id);
      }
      if (r.kind === 'tooluse_disposition') {
        return !coveredIds.has(dispositionIdentity(r));
      }
      if (r.kind === 'seq_hwm' && typeof r.seq === 'number') {
        if (r.seq !== hwmMax.get(r.session_id)) return false;
        if (hwmKeptFor.has(r.session_id)) return false;
        hwmKeptFor.add(r.session_id);
        return true;
      }
      return true;
    });
    if (kept.length !== fresh.length) {
      rewriteRecords(file, handle, kept);
    }
    return { ok: true, dropped: fresh.length - kept.length, frontiers: frontierAppends.length, reports };
  });
}

// Full-content rewrite under an already-held lock: same staging + rename
// discipline as stageAndCommit, but the staged content IS the record set.
function rewriteRecords(file, handle, records) {
  receiptLog.ensureOwned(handle);
  const staged = path.join(handle.lockdir, `staged-${handle.token}`);
  const body = records.map(r => JSON.stringify(r) + '\n').join('');
  const sfd = fs.openSync(
    staged,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
    0o600
  );
  try {
    const buf = Buffer.from(body, 'utf8');
    let off = 0;
    while (off < buf.length) {
      const n = fs.writeSync(sfd, buf, off, buf.length - off, off);
      if (n <= 0) throw new Error('dispatch-log: short write while staging rewrite');
      off += n;
    }
    fs.fsyncSync(sfd);
  } finally {
    fs.closeSync(sfd);
  }
  receiptLog.ensureOwned(handle);
  fs.renameSync(staged, file);
  receiptLog.fsyncDirOf(file); // the rename itself must survive a crash
}

module.exports = {
  EXPIRY_MS,
  MCP_REVIEW_TOOLS,
  REVIEW_PLANES,
  canonicalJson,
  requestKey,
  transcriptFileId,
  prefixDigest,
  rangeDigest,
  requestAskedForCodeReview,
  requestAskedForDocReview,
  jsonFencedGates,
  outputIsDocReview,
  outputIsCodeReview,
  outputIsBackgroundHandoff,
  docReviewVerdict,
  codeReviewVerdict,
  scanTranscript,
  foldRecords,
  expiredForPairing,
  agedForRetention,
  buildPlaneResults,
  appendActivation,
  appendDispatch,
  markBackgroundOwned,
  sweep,
  compactDispatchRecords,
  cursorPath,
  logFileOf,
};
