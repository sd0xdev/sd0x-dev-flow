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
}
