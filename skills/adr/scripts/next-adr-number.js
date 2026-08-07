#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Numeric max, not lexical sort: string-sorting "adr-9-..." after "adr-10-..." would collide.
// Case-insensitive: a hand-written "ADR-006-x.md" on a case-insensitive filesystem must still
// count toward the max, or its number gets reissued.
function nextAdrNumber(featureDir) {
  let max = 0;
  for (const dir of [featureDir, path.join(featureDir, 'archived')]) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const m = name.match(/^adr-(\d+)-/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return String(max + 1).padStart(3, '0');
}

module.exports = { nextAdrNumber };

if (require.main === module) {
  const featureDir = process.argv[2];
  if (!featureDir) {
    console.error('Usage: node next-adr-number.js <featureDir>');
    process.exit(1);
  }
  console.log(nextAdrNumber(featureDir));
}
