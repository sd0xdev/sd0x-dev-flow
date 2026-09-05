'use strict';
// Fault injector for the adapter's allocation guard, loaded via NODE_OPTIONS=--require before the
// adapter runs. `node:fs`'s exports are mutable, so no production seam is needed — a reviewer showed
// this route after an earlier test claimed these branches could not be driven from outside.
//
// FS_FAULT names the call to break; it throws only for the adapter's own scratch paths, so unrelated
// filesystem work in the same process is untouched.
const fs = require('node:fs');
const which = process.env.FS_FAULT;
const mine = (p) => typeof p === 'string' && p.includes('codex-exec-');

if (which === 'chmod') {
  const real = fs.chmodSync;
  fs.chmodSync = (p, m) => { if (mine(p)) throw new Error('injected chmod failure'); return real(p, m); };
} else if (which === 'stat') {
  const real = fs.statSync;
  fs.statSync = (p, o) => { if (mine(p)) throw new Error('injected stat failure'); return real(p, o); };
} else if (which === 'mode') {
  // Neither call throws; the mode simply comes back wrong, which is the OTHER branch of the guard.
  const real = fs.statSync;
  fs.statSync = (p, o) => { const st = real(p, o); if (mine(p)) return { ...st, mode: 0o40500 }; return st; };
} else if (which === 'rm') {
  // cleanup()'s own guard — the branch the alloc trio above does not reach. rmSync is the only call
  // on that path, so this is the whole surface.
  const real = fs.rmSync;
  fs.rmSync = (p, o) => { if (mine(p)) throw new Error('injected rm failure'); return real(p, o); };
} else if (which === 'readstream') {
  // A post-start failure that is NOT the child's: the prompt read stream errors after spawn. This is
  // the path a review found bypassing the `failed` snapshot — it used to call fail() directly.
  const real = fs.createReadStream;
  fs.createReadStream = (p, o) => { const s = real(p, o); if (mine(p)) s.destroy(new Error('injected prompt read failure')); return s; };
} else if (which === 'sweep-readdir') {
  // alloc()'s stale sweep: its ONLY readdir. A root user's readdir succeeds on a 0300 directory, so
  // the permission route the first test took cannot prove this catch everywhere; this can.
  const real = fs.readdirSync;
  fs.readdirSync = (p, o) => { if (mine(p) || String(p).includes('cx-sweep-root-')) throw new Error('injected readdir failure'); return real(p, o); };
} else if (which === 'pause-before-spawn') {
  // Hold the adapter at the instant BEFORE the real `codex` spawn, so a test can read what preflight
  // wrote while provably no child exists: the wrapper signals `${gate}.ready`, then blocks the (single-
  // threaded) adapter until `gate` appears. FS_FAULT_GATE names the gate inside the alloc dir.
  const cp = require('node:child_process'); const real = cp.spawn; const gate = process.env.FS_FAULT_GATE;
  cp.spawn = (...a) => {
    fs.writeFileSync(`${gate}.ready`, '');
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(gate)) { if (Date.now() > deadline) throw new Error('pause-before-spawn: gate never opened'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); }
    return real(...a);
  };
} else if (which === 'progress-owner-write') {
  // The guaranteed preflight write of the owner record fails: the fd that opened progress.json is
  // remembered and the first write to it throws. Every other write (the report, the events) is real.
  const realOpen = fs.openSync, realWrite = fs.writeSync; let fd = null;
  fs.openSync = (p, ...a) => { const r = realOpen(p, ...a); if (typeof p === 'string' && p.endsWith('/progress.json')) fd = r; return r; };
  fs.writeSync = (f, ...a) => { if (f === fd) throw new Error('injected owner-record write failure'); return realWrite(f, ...a); };
} else if (which === 'sweep-kill-eperm') {
  // `kill(pid, 0)` refused: the process exists but is not ours to signal. FS_FAULT_PID names it.
  const pid = Number(process.env.FS_FAULT_PID); const real = process.kill.bind(process);
  process.kill = (p, sig) => { if (p === pid && (sig === 0 || sig === undefined)) { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; } return real(p, sig); };
} else if (which === 'sweep-fifo-swap') {
  // Between "this is a regular file" and the open, a same-UID neighbour swaps a FIFO in at the
  // owner-record path: a blocking open then waits for a writer that never comes, and the sweep —
  // and alloc with it — hangs. FS_FAULT_TARGET names the candidate directory; the hook fires on the
  // adapter's open of its progress.json and installs the FIFO first.
  const path = require('node:path'); const target = process.env.FS_FAULT_TARGET;
  const real = fs.openSync; let done = false;
  fs.openSync = (p, ...a) => {
    if (!done && typeof p === 'string' && path.basename(p) === 'progress.json' && path.basename(path.dirname(p)) === target) {
      done = true; fs.renameSync(p, `${p}.orig`); require('node:child_process').spawnSync('mkfifo', [p]);
      const o = new Date(Date.now() - 25 * 3600 * 1000); fs.utimesSync(path.dirname(p), o, o);   // the swap refreshed the dir mtime; a neighbour who swaps can also `touch -t` it back
    }
    return real(p, ...a);
  };
} else if (which === 'sweep-owner-read-budget') {
  // The owner record is a 96-byte prefix by contract: any whole-file read of the candidate's
  // progress.json, or a descriptor read of another length, throws — so a regression to
  // readFileSync would surface as a swallowed failure (no liveness) rather than pass unnoticed.
  const path = require('node:path'); const target = process.env.FS_FAULT_TARGET;
  const isOwner = (p) => typeof p === 'string' && path.basename(p) === 'progress.json' && path.basename(path.dirname(p)) === target;
  const realOpen = fs.openSync, realRead = fs.readSync, realReadFile = fs.readFileSync; let ownerFd = null;
  let ownerReads = 0;
  fs.openSync = (p, ...a) => { const fd = realOpen(p, ...a); if (isOwner(p)) ownerFd = fd; return fd; };
  // Exactly ONE read of the owner descriptor, 96 bytes at offset 0 from position 0; and a whole-file
  // read through the numeric descriptor is refused as much as one through the path — a review showed
  // `readFileSync(fd)` slipping past a path-only check.
  // Poisoned rather than thrown: a thrown probe error reads as "unknown, keep" (the tri-state), which
  // would let a whole-file regression pass. An off-contract read gets `{}` instead — no owner in it.
  fs.readSync = (fd, buf, off, len, pos) => { if (fd === ownerFd && (ownerReads++ !== 0 || off !== 0 || len !== 96 || pos !== 0)) { buf.write('{}', 0); return 2; } return realRead(fd, buf, off, len, pos); };
  fs.readFileSync = (p, ...a) => { if (p === ownerFd || isOwner(p)) return Buffer.from('{}'); return realReadFile(p, ...a); };
} else if (which === 'sweep-owner-swap-after-open') {
  // The descriptor is open on the real owner record; THEN the neighbour moves that file aside and
  // puts a directory at the path. fstat on the descriptor still sees the regular file it opened;
  // a stat by name sees the directory. Only the former keeps the live candidate.
  const path = require('node:path'); const target = process.env.FS_FAULT_TARGET;
  const realOpen = fs.openSync; let done = false;
  fs.openSync = (p, ...a) => {
    const fd = realOpen(p, ...a);
    if (!done && typeof p === 'string' && path.basename(p) === 'progress.json' && path.basename(path.dirname(p)) === target) {
      done = true; fs.renameSync(p, `${p}.orig`); fs.mkdirSync(p);
      const o = new Date(Date.now() - 25 * 3600 * 1000); fs.utimesSync(path.dirname(p), o, o);   // as above: the mtime must not be what saves the candidate here
    }
    return fd;
  };
} else if (which === 'sweep-probe-error') {
  // An UNEXPECTED error while probing the owner — FS_FAULT_STEP names which call (`open`, `kill`),
  // FS_FAULT_CODE the errno it throws with. Not proof of death: the candidate must be kept.
  const path = require('node:path'); const target = process.env.FS_FAULT_TARGET, step = process.env.FS_FAULT_STEP, code = process.env.FS_FAULT_CODE;
  const isOwner = (p) => typeof p === 'string' && path.basename(p) === 'progress.json' && path.basename(path.dirname(p)) === target;
  const boom = () => { const e = new Error(code); e.code = code; throw e; };
  if (step === 'open') { const real = fs.openSync; fs.openSync = (p, ...a) => { if (isOwner(p)) boom(); return real(p, ...a); }; }
  else if (step === 'fstat' || step === 'read') {   // the OUTER catch: a failure after the descriptor is open
    const realOpen = fs.openSync; let ownerFd = null;
    fs.openSync = (p, ...a) => { const fd = realOpen(p, ...a); if (isOwner(p)) ownerFd = fd; return fd; };
    if (step === 'fstat') { const real = fs.fstatSync; fs.fstatSync = (fd, ...a) => { if (fd === ownerFd) boom(); return real(fd, ...a); }; }
    else { const real = fs.readSync; fs.readSync = (fd, ...a) => { if (fd === ownerFd) boom(); return real(fd, ...a); }; }
  }
  else { const real = process.kill.bind(process); process.kill = (p, sig) => { if (p === Number(process.env.FS_FAULT_PID) && (sig === 0 || sig === undefined)) boom(); return real(p, sig); }; }
} else if (which === 'sweep-reactivate') {
  // Between the checks under the old name and the rename into quarantine, a delayed `start` on
  // the SAME inode writes its owner record and refreshes the directory: the sweep must re-decide
  // on the quarantined inode and give the directory back.
  const path = require('node:path'); const target = process.env.FS_FAULT_TARGET; const real = fs.renameSync; let done = false;
  fs.renameSync = (from, to) => {
    if (!done && typeof from === 'string' && path.basename(from) === target) { done = true; fs.writeFileSync(path.join(from, 'progress.json'), `{"protocol":1,"status":"starting","pid":${process.pid}}\n`); const now = new Date(); fs.utimesSync(from, now, now); }
    return real(from, to);
  };
} else if (which === 'report-close') {
  // The report's preflight close fails: still exit 2 `invalid_report_file`, never an uncaught throw
  // (exit 1 would read as codex_fail and dispatch a fallback for a run that never launched).
  const realOpen = fs.openSync, realClose = fs.closeSync; let fd = null;
  fs.openSync = (p, ...a) => { const r = realOpen(p, ...a); if (typeof p === 'string' && p.endsWith('/report.md')) fd = r; return r; };
  fs.closeSync = (f) => { if (f === fd) { fd = null; throw new Error('injected report close failure'); } return realClose(f); };
} else if (which === 'snapshot-chmod' || which === 'snapshot-rename') {
  // The best-effort snapshot failing on EVERY event: a chmod that throws (the helper must close and
  // unlink what it created) or a rename that throws (the temp must be unlinked). Either way the
  // run completes and the alloc dir holds no `.tmp` debris afterwards.
  const isTmp = (p) => typeof p === 'string' && /progress\.json\.\d+.*\.tmp$/.test(p);
  if (which === 'snapshot-rename') { const real = fs.renameSync; fs.renameSync = (a, b) => { if (isTmp(a)) throw new Error('injected snapshot rename failure'); return real(a, b); }; }
  else {
    // The failed descriptor stays tracked until production CLOSES it: a second temp open while one
    // is still live exits 97, so a missing close is observable (a review showed the first version
    // forgetting the fd at the throw, which made the close unobservable).
    const realOpen = fs.openSync, realChmod = fs.fchmodSync, realClose = fs.closeSync; const tmpFds = new Set();
    fs.openSync = (p, ...a) => { if (isTmp(p) && tmpFds.size) process.exit(97); const fd = realOpen(p, ...a); if (isTmp(p)) tmpFds.add(fd); return fd; };
    fs.fchmodSync = (fd, m) => { if (tmpFds.has(fd)) throw new Error('injected snapshot chmod failure'); return realChmod(fd, m); };
    fs.closeSync = (fd) => { const r = realClose(fd); tmpFds.delete(fd); return r; };
  }
} else if (['sweep-lstat', 'sweep-rm', 'sweep-foreign-uid', 'sweep-rename', 'sweep-recheck', 'sweep-restore', 'sweep-swap', 'sweep-swap-q',
  'sweep-swap-after-pin', 'sweep-swap-child', 'sweep-swap-child-after-recheck', 'sweep-cwd', 'sweep-readdir-inner'].includes(which)) {
  // Per-entry faults of the same sweep, aimed at ONE basename (FS_FAULT_TARGET). The listing is
  // reordered to put the target FIRST — enumeration order is unspecified, and a continuation
  // assertion ("the other entry was still reaped") proves nothing unless the fault provably came
  // first. `sweep-foreign-uid` throws nothing: the entry looks reapable in every way except
  // ownership, and a Proxy keeps the real Stats prototype (spreading a Stats drops isDirectory).
  const path = require('node:path');
  const target = process.env.FS_FAULT_TARGET;
  const hit = (p) => typeof p === 'string' && path.basename(p) === target;
  const realReaddir = fs.readdirSync, realRename = fs.renameSync, realLstat = fs.lstatSync, realStat = fs.statSync;
  fs.readdirSync = (p, o) => { const names = realReaddir(p, o); return names.includes(target) ? [target, ...names.filter((n) => n !== target)] : names; };
  const isQuarantine = (p) => typeof p === 'string' && path.basename(p).startsWith('.reap-');
  // The swap the {dev, ino} checks exist for: a same-UID neighbour moves the validated directory
  // aside and puts a FRESH, non-empty directory under the name the adapter is about to act on.
  const swapDir = (at, file, body) => { realRename(at, `${at}.orig`); fs.mkdirSync(at); fs.chmodSync(at, 0o700); fs.writeFileSync(path.join(at, file), body); };
  let q = null;   // the quarantine name the adapter chose for the target, learned from its rename
  const learnQ = () => { fs.renameSync = (from, to) => { if (hit(from)) q = to; return realRename(from, to); }; };
  if (which === 'sweep-lstat') {
    fs.lstatSync = (p, o) => { if (hit(p)) throw new Error('injected lstat failure'); return realLstat(p, o); };
  } else if (which === 'sweep-foreign-uid') {
    fs.lstatSync = (p, o) => { const st = realLstat(p, o); return hit(p) ? new Proxy(st, { get: (t, k) => (k === 'uid' ? t.uid + 1 : Reflect.get(t, k, t)) }) : st; };
  } else if (which === 'sweep-rename') {                 // rename(d, q) itself fails: the entry stays under its own name
    fs.renameSync = (from, to) => { if (hit(from)) throw new Error('injected rename failure'); return realRename(from, to); };
  } else if (which === 'sweep-recheck') {                // rename(d, q) succeeded, lstat(q) fails: the entry stays quarantined
    learnQ();
    fs.lstatSync = (p, o) => { if (q !== null && p === q) throw new Error('injected recheck failure'); return realLstat(p, o); };
  } else if (which === 'sweep-swap' || which === 'sweep-restore') {
    let swapped = false;
    fs.renameSync = (from, to) => {
      if (hit(from) && !swapped) { swapped = true; swapDir(from, 'fresh.txt', 'a dispatch in flight'); }
      // sweep-restore: the identity mismatch is detected but the rename BACK fails — the substitute stays quarantined
      if (which === 'sweep-restore' && isQuarantine(from) && hit(to)) throw new Error('injected restore failure');
      return realRename(from, to);
    };
  } else if (which === 'sweep-swap-q') {
    // The window AFTER the quarantine re-check: lstat(q) verified the inode, then a neighbour swaps
    // a fresh, non-empty directory in at q. reapPinned's own stat('.') identity is what refuses it.
    learnQ();
    fs.lstatSync = (p, o) => { const st = realLstat(p, o); if (q !== null && p === q) { const at = q; q = null; swapDir(at, 'fresh.txt', 'a dispatch in flight'); } return st; };
  } else if (which === 'sweep-swap-after-pin') {
    // The window AFTER the pin: stat('.') matched, so the relative unlinks are about to run — now
    // the neighbour swaps q. The adapter's cwd is the ORIGINAL inode (now at q.orig): only a
    // path-based unlink through q would reach the substitute, and its file shares the stale one's name.
    learnQ();
    fs.statSync = (p, o) => { const st = realStat(p, o); if (p === '.' && q !== null && process.cwd() === q) { const at = q; q = null; swapDir(at, 'report.md', 'live substitute'); } return st; };
  } else if (which === 'sweep-swap-child') {
    // One level down: the entry report.md was lstat'ed as a regular file; before the adapter acts on
    // it, the neighbour moves it aside and puts another regular file under the same relative name.
    let done = false;
    fs.lstatSync = (p, o) => { const st = realLstat(p, o); if (p === 'report.md' && !done) { done = true; realRename('report.md', 'report.md.orig'); fs.writeFileSync('report.md', 'live child'); } return st; };
  } else if (which === 'sweep-swap-child-after-recheck') {
    // The LAST window, inside the inner rename → lstat → unlink: the adapter has just re-lstat'ed
    // the entry under its random inner name; before the unlink, a neighbour moves that inode aside
    // and puts another file under the same random name. Only a hook on lstat itself can land here —
    // a real neighbour would have to guess a name that exists for microseconds.
    let done = false;
    fs.lstatSync = (p, o) => { const st = realLstat(p, o); if (!done && typeof p === 'string' && !path.isAbsolute(p) && p.startsWith('.reap-')) { done = true; realRename(p, `${p}.orig`); fs.writeFileSync(p, 'live after recheck'); } return st; };
  } else if (which === 'sweep-cwd') {                    // process.cwd() throws once the target is quarantined: a sweep failure, never alloc's
    let armed = false; const realCwd = process.cwd.bind(process);
    fs.renameSync = (from, to) => { const r = realRename(from, to); if (hit(from)) armed = true; return r; };
    process.cwd = () => { if (armed) { armed = false; throw new Error('injected cwd failure'); } return realCwd(); };
  } else if (which === 'sweep-readdir-inner') {          // readdir('.') inside the pinned dir throws: reapPinned's outer catch
    let done = false;
    fs.readdirSync = (p, o) => { if (p === '.' && !done) { done = true; throw new Error('injected inner readdir failure'); } const names = realReaddir(p, o); return names.includes(target) ? [target, ...names.filter((n) => n !== target)] : names; };
  } else if (which === 'sweep-rm') {
    // Deletion is per-entry rename → lstat → unlink inside the pinned quarantine dir, then a
    // non-recursive rmdir. The fault hits the FIRST unlink (the target is enumerated first): the
    // file stays (under its inner quarantine name), rmdir refuses the non-empty dir, the entry stays
    // quarantined — the evidence trail — and the loop reaps the next.
    const realUnlink = fs.unlinkSync; let done = false;
    fs.unlinkSync = (p) => { if (!done) { done = true; throw new Error('injected unlink failure'); } return realUnlink(p); };
  }
}
