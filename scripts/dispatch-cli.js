#!/usr/bin/env node
'use strict';

// Hook-facing CLI for the MCP dispatch lifecycle (WB3). Reads the full hook
// payload JSON on stdin and runs one subcommand:
//   activate            SessionStart — append the activation barrier record
//   dispatch            PreToolUse   — append the dispatch record (visibility
//                                      decision included). A non-zero exit is
//                                      the hook's exit-2 duty: the call must
//                                      not run unrecorded.
//   own --task-id <id>  PostToolUse  — background handoff ownership marking
//   sweep               any event    — pairing sweep (bind / settle /
//                                      quarantine / cursor advance)
//   compact             SessionStart — liveness-based record compaction
// Protocol: docs/features/auto-loop-evolution/2-tech-spec/
// 2-content-addressed-receipts.md §3.4.

const fs = require('fs');
const dispatchLog = require('./lib/dispatch-log');
const treeDigest = require('./lib/tree-digest');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function fail(msg, code = 1) {
  process.stderr.write(`dispatch-cli: ${msg}\n`);
  process.exit(code);
}

function emit(result) {
  for (const r of result.reports || []) {
    process.stderr.write(`dispatch-cli: ${r}\n`);
  }
  const { reports, ...rest } = result;
  process.stdout.write(JSON.stringify(rest) + '\n');
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opts = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--task-id' && argv[i + 1]) opts.taskId = argv[++i];
    else if (argv[i] === '--repo' && argv[i + 1]) opts.repo = argv[++i];
  }
  if (!['activate', 'dispatch', 'own', 'sweep', 'compact'].includes(cmd)) {
    fail(`unknown command ${JSON.stringify(cmd)} (want activate|dispatch|own|sweep|compact)`);
  }

  const repoRoot = opts.repo || process.cwd();
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch (e) {
    fail(`unreadable hook payload: ${String(e.message)}`);
  }
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  if (!sessionId) fail('hook payload carries no session_id');
  if (!transcriptPath) fail('hook payload carries no transcript_path');

  try {
    if (cmd === 'activate') {
      emit(dispatchLog.appendActivation(repoRoot, { sessionId, transcriptPath }));
      return;
    }
    if (cmd === 'sweep') {
      const result = dispatchLog.sweep(repoRoot, { sessionId, transcriptPath });
      emit(result);
      // A sweep that could not run is loud but non-blocking: the gate simply
      // stays open (fail-closed) and later hook events retry.
      return;
    }
    if (cmd === 'compact') {
      emit(dispatchLog.compactDispatchRecords(repoRoot, { sessionId, transcriptPath }));
      return;
    }
    // dispatch / own both need the request key's source.
    const toolInput = payload.tool_input;
    if (toolInput === undefined || toolInput === null) fail('hook payload carries no tool_input');
    const inputText = JSON.stringify(toolInput);
    if (cmd === 'own') {
      if (!opts.taskId) fail('own requires --task-id');
      const key = dispatchLog.requestKey(toolInput);
      const result = dispatchLog.markBackgroundOwned(repoRoot, {
        sessionId,
        transcriptPath,
        key,
        taskId: opts.taskId,
      });
      emit(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    // dispatch: request-side plane detection decides what this call opens.
    // The digests pin what the tree was at dispatch — but the RECORD is the
    // accounting duty, not the digest: a review call that runs unrecorded
    // creates an in-barrier orphan the next same-key capture can bind to.
    // So an undigestable tree (not a git checkout, merge conflict) degrades
    // to a null digest INSIDE the record, loudly: null never matches a
    // check-time recomputation, so no gate can close on it — the gate stays
    // open and the entry stays accounted, both fail-closed.
    let state = { planes: {} };
    try {
      state = treeDigest.computeTreeState(fs.realpathSync(repoRoot));
    } catch (e) {
      process.stderr.write(
        `dispatch-cli: tree digest unavailable (${String(e.message)}) — dispatch recorded with null digests, gate cannot close on it\n`
      );
    }
    const normDigest = p => {
      const d = state.planes && state.planes[p] ? state.planes[p].digest : null;
      if (typeof d === 'string' && d.length > 0) return d;
      process.stderr.write(
        `dispatch-cli: ${p} digest unavailable (partial tree) — plane recorded with null digest\n`
      );
      return null;
    };
    const planes = {};
    if (dispatchLog.requestAskedForCodeReview(inputText)) {
      planes.code_review = normDigest('code');
    }
    if (dispatchLog.requestAskedForDocReview(inputText)) {
      planes.doc_review = normDigest('doc');
    }
    if (Object.keys(planes).length === 0) {
      emit({ ok: true, skipped: 'not a review request' });
      return;
    }
    emit(dispatchLog.appendDispatch(repoRoot, { sessionId, transcriptPath, toolInput, planes }));
  } catch (e) {
    fail(String((e && e.message) || e));
  }
}

main();
