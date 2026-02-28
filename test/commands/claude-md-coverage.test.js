const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const commandsDir = resolve(root, 'commands');
const templatePath = resolve(root, 'CLAUDE.template.md');
const claudeMdPath = resolve(root, 'CLAUDE.md');

/**
 * Extract the Command Quick Reference section from markdown content.
 */
function extractCommandSection(content) {
  const start = content.indexOf('## Command Quick Reference');
  if (start === -1) return '';
  const rest = content.slice(start);
  const nextSection = rest.indexOf('\n## ', 1);
  return nextSection === -1 ? rest : rest.slice(0, nextSection);
}

/**
 * Extract command names from a CLAUDE.md-style Command Quick Reference table.
 * Returns an array (preserving duplicates for detection).
 * Matches rows like: | `/some-command` | description | when |
 */
function extractTableCommands(content) {
  const section = extractCommandSection(content);
  const commands = [];
  const re = /^\|\s*`\/([^`]+)`\s*\|/gm;
  let m;
  while ((m = re.exec(section)) !== null) {
    commands.push(m[1]);
  }
  return commands;
}

/**
 * Get all command file basenames (without .md extension) from commands/ dir.
 */
function getCommandFiles() {
  return readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

test('every commands/*.md is listed in CLAUDE.template.md', () => {
  const templateContent = readFileSync(templatePath, 'utf8');
  const tableCommands = new Set(extractTableCommands(templateContent));
  const fileCommands = getCommandFiles();

  const missing = fileCommands.filter((cmd) => !tableCommands.has(cmd));
  assert.deepStrictEqual(
    missing,
    [],
    `commands/ files missing from CLAUDE.template.md table: ${missing.join(', ')}`
  );
});

test('every CLAUDE.template.md table entry has a commands/*.md file', () => {
  const templateContent = readFileSync(templatePath, 'utf8');
  const tableCommands = extractTableCommands(templateContent);
  const fileCommands = new Set(getCommandFiles());

  const orphaned = tableCommands.filter((cmd) => !fileCommands.has(cmd));
  assert.deepStrictEqual(
    orphaned,
    [],
    `CLAUDE.template.md table entries without commands/ file: ${orphaned.join(', ')}`
  );
});

test('no duplicate commands in CLAUDE.template.md table', () => {
  const templateContent = readFileSync(templatePath, 'utf8');
  const tableCommands = extractTableCommands(templateContent);
  const seen = new Set();
  const duplicates = [];
  for (const cmd of tableCommands) {
    if (seen.has(cmd)) duplicates.push(cmd);
    seen.add(cmd);
  }
  assert.deepStrictEqual(
    duplicates,
    [],
    `Duplicate commands in CLAUDE.template.md: ${duplicates.join(', ')}`
  );
});

test('CLAUDE.md table matches CLAUDE.template.md table', () => {
  const templateContent = readFileSync(templatePath, 'utf8');
  const claudeContent = readFileSync(claudeMdPath, 'utf8');

  const templateCommands = [...extractTableCommands(templateContent)].sort();
  const claudeCommands = [...extractTableCommands(claudeContent)].sort();

  assert.deepStrictEqual(
    claudeCommands,
    templateCommands,
    `CLAUDE.md and CLAUDE.template.md command tables differ.\n` +
      `Only in template: ${templateCommands.filter((c) => !claudeCommands.includes(c)).join(', ') || 'none'}\n` +
      `Only in CLAUDE.md: ${claudeCommands.filter((c) => !templateCommands.includes(c)).join(', ') || 'none'}`
  );
});
