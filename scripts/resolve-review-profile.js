#!/usr/bin/env node
'use strict';

/**
 * Resolve a doc-review profile per changed file, and lay the result out as a batched dispatch plan.
 *
 * The profile narrows what the reviewer *reads*; it never decides whether review runs, and no
 * outcome here auto-passes anything (Anchor Register #5, #6). Escalation is one-way: this resolver
 * can only deepen what the producer asked for. Contract: `docs/features/doc-review-phasing/
 * 2-tech-spec.md` § 3.3–3.4 and § 4 Step 4.
 */

const fs = require('node:fs');
const path = require('node:path');

const { resolveDocRole, parseDocRoleState, FALLBACK_ROLE } = require('./lib/doc-metadata');

const TAXONOMY_PATH = path.join(__dirname, 'config', 'doc-taxonomy.json');
const SENSITIVE_PATH = path.join(__dirname, 'config', 'sensitive-paths.json');

const DEFAULT_BUDGET = { max_files: 12, max_bytes: 200000 };

/**
 * Depth order. `executable` and `implementation-sync` share a rank because neither is deeper than
 * the other — they ask different questions of different artifacts — so when a requested profile ties
 * with the role's own, the role's wins.
 */
const RANK = {
  'record-diff': 0,
  'living-sync': 1,
  'implementation-sync': 2,
  executable: 2,
  'full-design': 3,
};

const PROFILES = Object.keys(RANK);

/**
 * How much of the file the profile covers. The reviewer prompt binds on this, so it must follow the
 * *resolved* profile — a file that escalated to `full-design` and still reported `sections` would
 * have been escalated on paper only.
 */
const READ_BY_PROFILE = {
  'full-design': 'whole',
  'implementation-sync': 'sections',
  'living-sync': 'sections',
  executable: 'sections',
  'record-diff': 'hunks',
};

/** Instruction surfaces: loaded and executed as a unit, so their profile is about execution. */
const INSTRUCTION_SURFACE = /^(?:skills|rules|agents|commands)\//;

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function budgetFrom(taxonomy) {
  const configured = taxonomy && taxonomy.review_budget;
  if (!configured) return { ...DEFAULT_BUDGET };
  const files = Number(configured.max_files);
  const bytes = Number(configured.max_bytes);
  return {
    max_files: Number.isInteger(files) && files > 0 ? files : DEFAULT_BUDGET.max_files,
    max_bytes: Number.isInteger(bytes) && bytes > 0 ? bytes : DEFAULT_BUDGET.max_bytes,
  };
}

/**
 * Segment-anchored path matching, the same shape `hooks/post-edit-format.sh` implements against the
 * same config: a rule's entry matches a run of whole segments, exclude beats include, first rule
 * wins. Returns the rule name, `null` for a clean miss, or `'unknown'` when the config cannot be
 * read — and `unknown` is not `none`, because a deleted config would otherwise read as "checked and
 * clean", the inverse of what it means.
 */
const segmentList = (list) => Array.isArray(list) && list.every((s) => typeof s === 'string');

function sensitivityHit(filePath, config) {
  if (!config || config.version !== 1 || !Array.isArray(config.rules)) return 'unknown';
  const wrapped = `/${filePath}/`;
  for (const rule of config.rules) {
    // A malformed rule must read as `unknown` — which escalates — not throw. `exclude: "docs"` is
    // truthy and has no `.some`, so a shape check that stops at `include` turns fail-closed into a
    // crashed process, which fails nothing closed at all.
    if (!rule || typeof rule.name !== 'string' || !segmentList(rule.include)) return 'unknown';
    if (rule.exclude !== undefined && !segmentList(rule.exclude)) return 'unknown';
    const included = rule.include.some((seg) => wrapped.includes(`/${seg}/`));
    if (!included) continue;
    const excluded = (rule.exclude || []).some((seg) => wrapped.includes(`/${seg}/`));
    if (excluded) continue;
    return rule.name;
  }
  return null;
}

const HEADING_2 = /^ {0,3}##\s+(.*?)\s*#*\s*$/;
const PREAMBLE = '(preamble)';

/** Every line's enclosing `##` section, indexed by 1-based line number of the current file. */
function sectionIndex(source) {
  const sections = [];
  let current = PREAMBLE;
  for (const line of source.split('\n')) {
    const heading = HEADING_2.exec(line);
    if (heading) current = heading[1].trim();
    sections.push(current);
  }
  return sections;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const REMOVED_HEADING = /^-(#{2}\s+)(.+?)\s*#*\s*$/;

/**
 * Which `##` sections a unified diff touches.
 *
 * Resolved against **both** sides. The new side answers "where is the edit now"; the old side
 * answers the question the new side cannot: a section deleted in its entirety leaves a `+c,0`
 * location that maps to whichever section survived at line `c` — its *neighbour*. Whitelisting the
 * neighbour would then keep a shallow profile over a wholesale deletion, so the removed section has
 * to be named from the old side, or failing that from the removed `##` heading in the hunk body.
 *
 * @param {string} diffText unified diff with any context width
 * @param {string} source the file as it stands now
 * @param {string} [oldSource] the file at HEAD; omit when unavailable — heading detection still runs
 */
function changedSectionsFromDiff(diffText, source, oldSource) {
  const sections = sectionIndex(source);
  const oldSections = typeof oldSource === 'string' ? sectionIndex(oldSource) : null;
  const touched = new Set();

  // `to` is inclusive and callers pass `start + count - 1`, so a **zero-count side collapses to an
  // empty range and marks nothing** — which is the whole rule for those sides: they name where the
  // other side's lines went or came from and contain no changed line of their own. Marking one
  // anyway would attribute a pure insertion in section B to section A as well, and a whitelist
  // correctly naming B would escalate for no reason. The invariant lives here rather than in a
  // guard at each call site, because a guard at the call site is unreachable and a test cannot
  // tell it from its own absence.
  const mark = (index, from, to) => {
    if (!index || !index.length) return;
    for (let n = Math.max(1, from); n <= to; n += 1) {
      touched.add(index[Math.min(n, index.length) - 1] || PREAMBLE);
    }
  };

  for (const line of String(diffText || '').split('\n')) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      const oldStart = Number(hunk[1]);
      const oldCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const newStart = Number(hunk[3]);
      const newCount = hunk[4] === undefined ? 1 : Number(hunk[4]);
      mark(sections, newStart, newStart + newCount - 1);
      mark(oldSections, oldStart, oldStart + oldCount - 1);
      continue;
    }
    const removed = REMOVED_HEADING.exec(line);
    if (removed) touched.add(removed[2].trim());
  }
  return [...touched];
}

/**
 * The shallowest profile this artifact may be reviewed at.
 *
 * `living-sync` and `implementation-sync` differ by one fact about the *change*, not about the file:
 * whether code landed alongside it. That fact is an input, and it fails toward the deeper read — an
 * unstated answer buys `implementation-sync`, because "no code changed" is a claim, and an unmade
 * claim must not be worth more than a made one.
 */
function baseProfile(filePath, role, codeChanged = true) {
  if (role !== FALLBACK_ROLE) return 'record-diff';
  if (INSTRUCTION_SURFACE.test(filePath)) return 'executable';
  return codeChanged ? 'implementation-sync' : 'living-sync';
}

function deeper(a, b) {
  if (RANK[a] === undefined) return b;
  if (RANK[b] === undefined) return a;
  return RANK[a] > RANK[b] ? a : b;
}

/**
 * One file's profile, plus every reason it is not shallower.
 *
 * The whitelist is the load-bearing control and it fails closed: a producer asking for a shallow
 * profile must name the `##` sections its diff is confined to, and a diff that leaves them — or a
 * request that names none at all — gets `full-design`. Granting a shallow read on an undeclared diff
 * would make the request self-certifying, which is the whole thing this resolver replaces.
 */
function resolveFileProfile(entry, ctx) {
  const { path: filePath } = entry;
  const reasons = [];
  const role = entry.role || FALLBACK_ROLE;

  const base = baseProfile(filePath, role, ctx.codeChanged);
  let profile = deeper(entry.profile && RANK[entry.profile] !== undefined ? entry.profile : null, base);
  if (entry.profile && RANK[entry.profile] === undefined) {
    reasons.push(`requested profile '${entry.profile}' is not a profile`);
    profile = 'full-design';
  } else if (entry.profile && RANK[entry.profile] < RANK[base]) {
    reasons.push(`requested '${entry.profile}' is shallower than the role permits`);
  }

  if (entry.classification_unknown) {
    reasons.push('classification unknown or metadata malformed');
    profile = 'full-design';
  }

  const hit = sensitivityHit(filePath, ctx.sensitiveConfig);
  if (hit === 'unknown') {
    reasons.push('sensitive-paths config unreadable — unknown is not none');
    profile = 'full-design';
  } else if (hit) {
    reasons.push(`sensitive path (rule '${hit}')`);
    profile = 'full-design';
  }

  if (ctx.tierEscalates) {
    reasons.push(ctx.tierReason);
    profile = 'full-design';
  }

  // The whitelist checks a *producer's claim*, so it applies only where a claim was made. Without a
  // requested profile there is nothing to falsify: the role decides the depth and the diff decides
  // the sections, both computed here. Applying it to the derived profile too would escalate every
  // file on the default path — including every record, whose exemption is the point of the feature.
  if (RANK[profile] < RANK['full-design'] && !entry.is_new) {
    const declared = Array.isArray(entry.sections) ? entry.sections : [];
    const changed = entry.changed_sections || [];
    if (declared.length > 0) {
      const outside = changed.filter((s) => !declared.includes(s));
      if (outside.length > 0) {
        reasons.push(`diff touches undeclared section(s): ${outside.join(', ')}`);
        profile = 'full-design';
      }
    } else if (entry.profile && changed.length > 0) {
      reasons.push('no section whitelist declared for a requested shallow profile');
      profile = 'full-design';
    }
  }

  // A deleted document is read whole at HEAD: what is under review is everything that went away,
  // and there is nothing in the working tree to scope a shallower read against.
  return {
    path: filePath,
    role,
    requested: entry.profile || null,
    profile,
    read: entry.is_new || entry.is_deleted ? 'whole' : READ_BY_PROFILE[profile],
    deleted: Boolean(entry.is_deleted),
    reasons,
  };
}

/**
 * The feature folder a file is grouped under. Everything outside `docs/features/**` shares one
 * `(root)` group, emitted last so the ordering is total rather than merely stable.
 */
function groupOf(filePath) {
  const m = /^(docs\/features\/[^/]+)\//.exec(filePath);
  return m ? m[1] : '(root)';
}

/**
 * Two passes, and the second is what makes the bound real. Grouping alone bounds nothing — a single
 * feature folder in this repo is routinely over both limits on its own — so each group is then
 * chunked in path order, starting a new batch at the file that would exceed either limit.
 */
function batchPlan(files, budget) {
  // The case the whole feature exists to buy: everything fits, so the plan is one batch and one
  // dispatch. Grouping by feature folder here would split a three-file change into three reviews and
  // cost more than the per-file path it replaces — folders are how an over-budget plan is *cut*, not
  // how a plan is organized.
  const totalBytes = files.reduce((n, f) => n + (f.bytes || 0), 0);
  if (files.length <= budget.max_files && totalBytes <= budget.max_bytes) {
    return files.length === 0 ? [] : [{
      index: 0,
      group: '(plan)',
      files: files.map((f) => f.path),
      bytes: totalBytes,
      over_budget: false,
    }];
  }

  const groups = new Map();
  for (const file of files) {
    const key = groupOf(file.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }

  const ordered = [...groups.keys()].filter((k) => k !== '(root)').sort();
  if (groups.has('(root)')) ordered.push('(root)');

  const batches = [];
  for (const key of ordered) {
    const members = [...groups.get(key)].sort((a, b) => (a.path < b.path ? -1 : 1));
    let current = null;
    for (const file of members) {
      const bytes = file.bytes || 0;
      const wouldExceed = current
        && (current.files.length + 1 > budget.max_files || current.bytes + bytes > budget.max_bytes);
      if (!current || wouldExceed) {
        current = { index: batches.length, group: key, files: [], bytes: 0, over_budget: false };
        batches.push(current);
      }
      current.files.push(file.path);
      current.bytes += bytes;
      // A file larger than the whole byte budget is its own batch and is reported as such. There is
      // nothing left to split, and dropping it would be the silent truncation the loud-split rule
      // exists to prevent.
      if (current.files.length === 1 && bytes > budget.max_bytes) current.over_budget = true;
    }
  }
  return batches;
}

function tierVerdict(tier) {
  if (tier === undefined || tier === null || tier === '') {
    return { escalates: true, reason: 'no --tier supplied' };
  }
  if (!['fast', 'standard', 'thorough'].includes(tier)) {
    return { escalates: true, reason: `--tier '${tier}' is not a tier` };
  }
  if (tier === 'thorough') {
    return { escalates: true, reason: '--tier thorough (Anchor Register #3)' };
  }
  return { escalates: false, reason: null };
}

/**
 * @param {{files: Array, tier: string, taxonomy?: object, sensitiveConfig?: object}} input
 * @returns {{tier, budget, files, batches, escalated, warnings}}
 */
function resolvePlan(input) {
  const taxonomy = input.taxonomy === undefined ? loadJson(TAXONOMY_PATH) : input.taxonomy;
  const sensitiveConfig = input.sensitiveConfig === undefined
    ? loadJson(SENSITIVE_PATH) : input.sensitiveConfig;
  const budget = input.budget || budgetFrom(taxonomy);
  const tier = tierVerdict(input.tier);

  const ctx = {
    sensitiveConfig,
    tierEscalates: tier.escalates,
    tierReason: tier.reason,
    codeChanged: input.code_changed !== false,
  };

  const files = (input.files || []).map((entry) => ({
    ...resolveFileProfile(entry, ctx),
    bytes: entry.bytes || 0,
  }));

  const batches = batchPlan(files, budget);
  const warnings = [];
  if (batches.length > 1) {
    warnings.push(`plan split into ${batches.length} batches: `
      + `${files.length} files / ${files.reduce((n, f) => n + f.bytes, 0)} bytes `
      + `exceeds ${budget.max_files} files / ${budget.max_bytes} bytes`);
  }
  for (const batch of batches.filter((b) => b.over_budget)) {
    warnings.push(`batch ${batch.index} holds one file over the byte budget `
      + `(${batch.files[0]}, ${batch.bytes} bytes) — reviewed as its own batch, not skipped`);
  }

  return {
    tier: input.tier ?? null,
    budget,
    escalated: files.some((f) => f.profile === 'full-design'),
    files,
    batches,
    warnings,
  };
}

function argVal(argv, flag) {
  const i = argv.indexOf(flag);
  return i > -1 && i + 1 < argv.length ? argv[i + 1] : null;
}

/**
 * Read the repository facts the resolver needs for one file: git status, role, size, and changed
 * sections.
 *
 * Everything here is **derived**, never accepted from a caller. Status is the part that is easy to
 * leave out and impossible to substitute: an untracked file has no diff, so without asking git it
 * looks like an unchanged tracked file and gets a section-scoped read over content that is entirely
 * new; a deleted file is unreadable on disk, so it looks like a classification failure instead of a
 * document whose text still exists at HEAD.
 */
function inspect(filePath, root, taxonomy, git) {
  const abs = path.resolve(root, filePath);
  const unknown = (extra) => ({
    path: filePath, classification_unknown: true, is_new: false, is_deleted: false, bytes: 0, ...extra,
  });

  // "Is it in HEAD" is the question, not "is it in the index": a staged addition is tracked and has
  // no HEAD version, so an index membership test calls it an ordinary modification and scopes a
  // shallow read over content that is entirely new.
  const inHead = git.inHead(filePath);
  if (inHead === null) return unknown();

  let source = null;
  let readError = null;
  try {
    source = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    readError = err;
  }

  if (readError) {
    // Only "not there" is a deletion. Any other read failure — EACCES, EIO — leaves a file that is
    // still present, and substituting its HEAD text would review content nobody changed while
    // reporting the live version as gone.
    if (readError.code !== 'ENOENT' || !inHead) return unknown();
    const head = git.show(filePath);
    if (head === null) return unknown({ is_deleted: true });
    const declaredOld = parseDocRoleState(head, taxonomy);
    return {
      path: filePath,
      role: resolveDocRole(filePath, head, taxonomy),
      classification_unknown: declaredOld.state === 'invalid',
      is_new: false,
      is_deleted: true,
      bytes: Buffer.byteLength(head, 'utf8'),
      changed_sections: [...new Set(sectionIndex(head))],
    };
  }

  const declared = parseDocRoleState(source, taxonomy);
  const base = {
    path: filePath,
    role: resolveDocRole(filePath, source, taxonomy),
    classification_unknown: declared.state === 'invalid',
    is_new: !inHead,
    is_deleted: false,
    bytes: Buffer.byteLength(source, 'utf8'),
  };
  if (base.is_new) return { ...base, changed_sections: [] };

  // A failed `git diff` is not "nothing changed". Left as an empty string it reads as a clean file
  // and lets a requested shallow profile past the whitelist check on evidence that was never read.
  const diffText = git.diff(filePath);
  if (diffText === null) return { ...base, classification_unknown: true, changed_sections: [] };

  // The old side is not optional here. A deletion at the top of the file has a zero-count new side
  // and nothing else to go on, so without `HEAD:<file>` the section list comes back empty — which
  // reads as "changed nothing outside the whitelist" and lets a requested shallow profile through on
  // evidence that was never read. A tracked file whose `git show` fails is a question git declined
  // to answer, not a clean one.
  const oldSource = git.show(filePath);
  if (oldSource === null) return { ...base, classification_unknown: true, changed_sections: [] };
  return { ...base, changed_sections: changedSectionsFromDiff(diffText, source, oldSource) };
}

/** Git access, isolated so `inspect` is testable and so a failed call is a fact, not a throw. */
function gitAccess(root) {
  const { execFileSync } = require('node:child_process');
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };
  return {
    /** true / false / null when git itself could not answer — the third case must not read as false. */
    inHead(file) {
      const listed = run(['ls-tree', '-r', '--name-only', 'HEAD', '--', file]);
      return listed === null ? null : listed.trim().length > 0;
    },
    diff(file) {
      return run(['diff', '-U0', 'HEAD', '--', file]);
    },
    show(file) {
      return run(['show', `HEAD:${file}`]);
    },
  };
}

function main(argv) {
  const root = argVal(argv, '--root') || process.cwd();
  const taxonomy = loadJson(TAXONOMY_PATH);
  const planArg = argVal(argv, '--plan');
  const git = gitAccess(root);

  let input;
  if (planArg) {
    const raw = planArg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(planArg, 'utf8');
    const producer = JSON.parse(raw);
    // Producer intent is `profile` and `sections` — a claim about how to review. Everything else is
    // evidence, and evidence comes from the repository: accepting a producer's role, byte count or
    // changed-section list would let the claim certify itself.
    // Allowlist, not a spread: `budget`, `taxonomy` and `sensitiveConfig` are policy, and a plan
    // carrying `budget: {max_files: 999}` would otherwise buy itself one batch past the limit.
    input = {
      tier: producer.tier,
      code_changed: producer.code_changed,
      files: (producer.files || []).map((f) => ({
        ...inspect(String(f.path), root, taxonomy, git),
        profile: f.profile || null,
        sections: f.sections,
      })),
    };
  } else {
    const listed = argVal(argv, '--files');
    const requested = argVal(argv, '--profile');
    input = {
      tier: argVal(argv, '--tier') ?? undefined,
      files: (listed ? listed.split(',') : []).filter(Boolean)
        .map((f) => ({ ...inspect(f.trim(), root, taxonomy, git), profile: requested || null })),
    };
  }

  const plan = resolvePlan({ ...input, tier: input.tier ?? argVal(argv, '--tier') ?? undefined });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  PROFILES,
  inspect,
  gitAccess,
  RANK,
  DEFAULT_BUDGET,
  budgetFrom,
  sensitivityHit,
  sectionIndex,
  changedSectionsFromDiff,
  baseProfile,
  resolveFileProfile,
  groupOf,
  batchPlan,
  tierVerdict,
  resolvePlan,
  main,
};
