'use strict';

/**
 * A `--require` preload that makes `fs.readdirSync` fail with `EACCES` for one directory, named by
 * `READDIR_EACCES_PATH` (matched as a path suffix).
 *
 * `chmod 000` is the obvious way to produce an unreadable directory and it is the wrong one here,
 * for a reason that cost a round to find: git sees the files inside as **deleted**, so the analyze
 * run under test reports a documentation change, `doc_review` becomes a required-and-failing gate,
 * and `feature-complete` cannot fire for a reason that has nothing to do with `scan_error`. The
 * test then passes whether or not the code reads the flag — deleting the fix left it green.
 *
 * Injecting the failure at the syscall keeps the worktree clean and the diff empty, so the only
 * thing that differs between the control run and the failing one is the resolver's `scan_error`.
 *
 * Narrow on purpose: one directory, one API, and the error is constructed with the `code` the
 * scanner actually branches on (`ENOENT`/`ENOTDIR` are confirmed absence; everything else has to
 * reach the caller).
 */

const fs = require('node:fs');

const target = process.env.READDIR_EACCES_PATH || '';
const realReaddirSync = fs.readdirSync;

fs.readdirSync = function readdirSyncEacces(...args) {
  if (target && String(args[0]).endsWith(target)) {
    const err = new Error(`EACCES: permission denied, scandir '${String(args[0])}'`);
    err.code = 'EACCES';
    err.errno = -13;
    err.syscall = 'scandir';
    err.path = String(args[0]);
    throw err;
  }
  return realReaddirSync.apply(this, args);
};

module.exports = { realReaddirSync };
