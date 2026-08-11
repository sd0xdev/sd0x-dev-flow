const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/create-request/SKILL.md');

// --- SKILL.md content assertions ---

test('create-request SKILL.md has Scan Mode Workflow section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Scan Mode Workflow/, 'should have Scan Mode Workflow section');
});

test('create-request SKILL.md modes table has scan row', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /scan.*--status/i, 'should have scan mode with --status trigger');
});

test('create-request SKILL.md has stale detection (30 days)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /30 days/i, 'should mention 30 days stale threshold');
});

test('create-request SKILL.md has metadata format documentation', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Blockquote/i, 'should document blockquote format');
  assert.match(content, /[Tt]able/, 'should document table format');
});

test('create-request SKILL.md has complete status filter list', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Completed/, 'should list Completed as complete status');
  assert.match(content, /Done/, 'should list Done as complete status');
  assert.match(content, /Superseded/, 'should list Superseded as complete status');
});


test('create-request SKILL.md trigger keywords include scan', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /scan requests/, 'should have scan requests trigger keyword');
});

test('a closed ticket is frozen: update mode may change nothing on it', () => {
  const content = readFileSync(skillPath, 'utf8');
  // The freeze table: closed statuses map to "Nothing", and the closed set is defined once.
  assert.match(content, /Completed \/ Superseded \/ Archived.*\*\*Nothing\.\*\*/,
    'the freeze row must map every closed status to Nothing');
  assert.match(content, /CLOSED_REQUEST_STATUS/, 'the closed set is named, not restated');
  assert.match(content, /scripts\/lib\/request-status\.js/, 'and pointed at its single definition');
  // Reopening is a decision with a stated shape — a new ticket, never a rewrite of the record.
  assert.match(content, /new ticket that references it/);
  // The control: open statuses still list the fields update mode may touch.
  assert.match(content, /Pending \/ In Progress \/ Candidate Complete.*Status, Progress table, AC checkboxes/);
});

test('update-docs refuses to rewrite records — the other half of the freeze', () => {
  const updateDocs = readFileSync(resolve(__dirname, '../../skills/update-docs/SKILL.md'), 'utf8');
  assert.match(updateDocs, /It does not rewrite records/);
  assert.match(updateDocs, /\*\*Do not rewrite\.\*\*/, 'records get status and outcome appended, never a re-sync');
  assert.match(updateDocs, /owesCodeAlignment/, 'classification comes from doc-metadata, not from guessing');
});

test('new docs are written to a budget: ticket and tech-spec state theirs at write time', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /write-time target, not a gate/, 'the ticket budget is stated as write-time');
  const techSpec = readFileSync(resolve(__dirname, '../../skills/tech-spec/SKILL.md'), 'utf8');
  assert.match(techSpec, /Within the write-time budget/, 'the spec checklist binds on the budget');
  assert.match(techSpec, /> 400.*cohesion exception/s, 'over budget needs the exception stated in the document');
  const template = readFileSync(resolve(__dirname, '../../skills/tech-spec/references/template.md'), 'utf8');
  assert.match(template, /Budget: ≤ 300 lines/, 'the template opens with the number');
});
