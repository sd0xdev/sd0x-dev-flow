const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join, resolve, basename } = require('node:path');

const commandsDir = resolve(__dirname, '../../commands');

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

function splitFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { frontmatter: '', body: content };
  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

const INTENT_REQUIRED_COMMANDS = [
  'precommit.md',
  'precommit-fast.md',
  'verify.md',
  'dep-audit.md',
];

test('command frontmatter schema', () => {
  const files = walk(commandsDir);
  assert.ok(files.length >= 30, `expected >= 30 commands, found ${files.length}`);

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const { frontmatter, body } = splitFrontmatter(content);

    const descMatch = frontmatter.match(/^description:\s*(.+)\s*$/m);
    const description = descMatch ? descMatch[1].trim() : '';
    assert.ok(description, `${file} missing description in frontmatter`);

    const needsAllowedTools = /```bash/.test(body) || /Bash\(/.test(body);
    if (needsAllowedTools) {
      assert.ok(
        /^allowed-tools:/m.test(frontmatter),
        `${file} uses bash but missing allowed-tools in frontmatter`
      );
    }

    const fname = basename(file);
    if (INTENT_REQUIRED_COMMANDS.includes(fname)) {
      assert.ok(
        /^intent:/m.test(frontmatter),
        `${file} is a runner-backed command and must have intent: in frontmatter`
      );
      assert.ok(
        /goal:/m.test(frontmatter),
        `${file} intent block must have a goal`
      );
      assert.ok(
        /steps:/m.test(frontmatter),
        `${file} intent block must have steps`
      );
    }
  }
});
