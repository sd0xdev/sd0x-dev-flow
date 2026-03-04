#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const { runCapture } = require('../../../scripts/lib/utils');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const SUBCOMMAND = process.argv[2] || '';
const FORMAT = process.argv.includes('--markdown') ? 'markdown' : 'json';

const DEFAULT_BUDGET = 30;
const ALL_BUDGET = 200;
const BODY_MAX_CHARS = 2000;

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------
const GRAPHQL_QUERY = `query ($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      title
      number
      url
      headRefName
      baseRefName
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          diffSide
          comments(first: 20) {
            nodes {
              id
              databaseId
              body
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}`;

// ---------------------------------------------------------------------------
// PR target resolution
// ---------------------------------------------------------------------------
function parsePrUrl(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

function parseRepoArg(repoStr) {
  const parts = repoStr.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

async function resolvePrTarget() {
  const prArg = argVal('--pr');
  const repoArg = argVal('--repo');
  const urlArg = argVal('--url');

  // URL takes highest priority
  if (urlArg) {
    const parsed = parsePrUrl(urlArg);
    if (!parsed) {
      console.error('Error: Invalid PR URL format');
      process.exit(2);
    }
    return parsed;
  }

  // Explicit PR# — infer repo if not provided
  if (prArg) {
    let rp = null;
    if (repoArg) {
      rp = parseRepoArg(repoArg);
      if (!rp) {
        console.error('Error: Invalid --repo format. Expected owner/repo');
        process.exit(2);
      }
    } else {
      const repoView = await runCapture('gh', [
        'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner',
      ]);
      if (repoView.code === 0) rp = parseRepoArg(repoView.stdout.trim());
      if (!rp) {
        console.error('Error: --pr requires --repo or a git remote');
        process.exit(2);
      }
    }
    return { ...rp, number: parseInt(prArg, 10) };
  }

  // Try current branch PR
  const prView = await runCapture('gh', [
    'pr', 'view', '--json', 'number,headRefName,baseRefName,title,url',
  ]);
  if (prView.code === 0) {
    try {
      const data = JSON.parse(prView.stdout);
      // Get repo info
      const repoView = await runCapture('gh', [
        'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner',
      ]);
      if (repoView.code === 0) {
        const nwo = repoView.stdout.trim();
        const rp = parseRepoArg(nwo);
        if (rp) return { ...rp, number: data.number };
      }
    } catch { /* fall through */ }
  }

  console.error('Error: Cannot resolve PR. Use --pr <N> --repo <owner/repo> or --url <PR_URL>');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Fetch: GraphQL
// ---------------------------------------------------------------------------
async function fetchGraphQL(owner, repo, number) {
  const r = await runCapture('gh', [
    'api', 'graphql',
    '-f', `query=${GRAPHQL_QUERY}`,
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
    '-F', `pr=${number}`,
  ]);
  if (r.code !== 0) return null;

  try {
    const json = JSON.parse(r.stdout);
    const pr = json.data?.repository?.pullRequest;
    if (!pr) return null;
    return pr;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch: REST fallback
// ---------------------------------------------------------------------------
async function fetchREST(owner, repo, number) {
  const r = await runCapture('gh', [
    'api', `repos/${owner}/${repo}/pulls/${number}/comments`,
    '--paginate',
  ]);
  if (r.code !== 0) return null;

  try {
    const comments = JSON.parse(r.stdout);
    if (!Array.isArray(comments)) return null;
    return comments;
  } catch {
    return null;
  }
}

function groupRestComments(comments) {
  const groups = new Map();
  for (const c of comments) {
    const key = `${c.path || ''}:${c.original_position || c.position || 0}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: `REST_thread_${groups.size}`,
        path: c.path || '',
        line: c.original_line || c.line || null,
        isResolved: false, // unknown in REST
        isOutdated: c.position === null,
        comments: [],
      });
    }
    groups.get(key).comments.push({
      id: String(c.id),
      databaseId: c.id,
      author: c.user?.login || 'unknown',
      body: c.body || '',
      createdAt: c.created_at || '',
    });
  }
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// Normalize + filter + truncate
// ---------------------------------------------------------------------------
function truncateBody(body) {
  if (!body || body.length <= BODY_MAX_CHARS) return body || '';
  return body.slice(0, BODY_MAX_CHARS) + '... [truncated]';
}

function normalize(threads, { all = false, budget = DEFAULT_BUDGET } = {}) {
  let filtered = threads;

  if (!all) {
    filtered = filtered.filter(t => !t.isResolved && !t.isOutdated);
  }

  // Sort: unresolved first, not-outdated first, newest (latest comment) first
  filtered.sort((a, b) => {
    if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
    if (a.isOutdated !== b.isOutdated) return a.isOutdated ? 1 : -1;
    const aDate = a.comments.length > 0 ? a.comments[a.comments.length - 1].createdAt : '';
    const bDate = b.comments.length > 0 ? b.comments[b.comments.length - 1].createdAt : '';
    return bDate.localeCompare(aDate);
  });

  const cap = Math.min(budget, ALL_BUDGET);
  const truncated = filtered.length > cap ? filtered.length - cap : 0;
  filtered = filtered.slice(0, cap);

  // Set replyTargetId and truncate bodies
  for (const thread of filtered) {
    const firstComment = thread.comments[0];
    thread.replyTargetId = firstComment?.databaseId || null;
    for (const c of thread.comments) {
      c.body = truncateBody(c.body);
    }
  }

  return { threads: filtered, truncated };
}

// ---------------------------------------------------------------------------
// Normalize GraphQL response to thread model
// ---------------------------------------------------------------------------
function normalizeGraphQL(prData) {
  const nodes = prData.reviewThreads?.nodes || [];
  return nodes.map(t => ({
    id: t.id,
    path: t.path || '',
    line: t.line || t.startLine || null,
    isResolved: !!t.isResolved,
    isOutdated: !!t.isOutdated,
    diffSide: t.diffSide || null,
    comments: (t.comments?.nodes || []).map(c => ({
      id: c.id,
      databaseId: c.databaseId,
      author: c.author?.login || 'unknown',
      body: c.body || '',
      createdAt: c.createdAt || '',
    })),
  }));
}

// ---------------------------------------------------------------------------
// Format output
// ---------------------------------------------------------------------------
function formatMarkdown(result) {
  const { pr, summary, threads } = result;
  const lines = [];
  lines.push(`## PR #${pr.number}: ${pr.title}`);
  lines.push(`**Review Status**: ${summary.unresolved} unresolved / ${summary.total} total threads`);
  if (summary.truncated > 0) {
    lines.push(`**Truncated**: ${summary.truncated} threads excluded by budget`);
  }
  if (summary.degraded) {
    lines.push(`\n> REST fallback: thread resolution status unknown, showing all comments`);
  }
  lines.push('');
  lines.push('| # | File | Line | Reviewer | Comment (truncated) |');
  lines.push('|---|------|------|----------|---------------------|');
  threads.forEach((t, i) => {
    const firstComment = t.comments[0] || {};
    const preview = (firstComment.body || '').slice(0, 80).replace(/\n/g, ' ');
    lines.push(`| ${i + 1} | ${t.path} | ${t.line || '-'} | ${firstComment.author || '-'} | ${preview} |`);
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Subcommand: fetch
// ---------------------------------------------------------------------------
async function cmdFetch() {
  const { owner, repo, number } = await resolvePrTarget();
  const all = process.argv.includes('--all');
  const budgetRaw = argVal('--budget');
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : (all ? ALL_BUDGET : DEFAULT_BUDGET);
  if (!Number.isFinite(budget) || budget < 1 || budget > ALL_BUDGET) {
    console.error(`Error: --budget must be an integer between 1 and ${ALL_BUDGET}`);
    process.exit(2);
  }

  // Fetch metadata
  const metaR = await runCapture('gh', [
    'pr', 'view', String(number),
    '--repo', `${owner}/${repo}`,
    '--json', 'number,title,url,headRefName,baseRefName,state,reviewDecision',
  ]);
  if (metaR.code !== 0) {
    console.error(`Error: PR #${number} not found in ${owner}/${repo}`);
    process.exit(2);
  }

  let meta;
  try { meta = JSON.parse(metaR.stdout); } catch {
    console.error('Error: Failed to parse PR metadata');
    process.exit(2);
  }

  if (meta.state !== 'OPEN') {
    console.error(`Warning: PR #${number} is ${meta.state}, showing historical reviews`);
  }

  // Try GraphQL first
  let threads;
  let degraded = false;
  const gql = await fetchGraphQL(owner, repo, number);
  if (gql) {
    threads = normalizeGraphQL(gql);
    if (gql.reviewThreads?.pageInfo?.hasNextPage) {
      console.error('Warning: 100+ threads detected, showing first 100');
    }
  } else {
    // REST fallback
    const restComments = await fetchREST(owner, repo, number);
    if (!restComments) {
      console.error('Error: Failed to fetch review comments');
      process.exit(2);
    }
    threads = groupRestComments(restComments);
    degraded = true;
  }

  const total = threads.length;
  const unresolved = threads.filter(t => !t.isResolved).length;
  const outdated = threads.filter(t => t.isOutdated).length;

  const { threads: normalized, truncated } = normalize(threads, { all, budget });

  const result = {
    pr: {
      number: meta.number,
      title: meta.title,
      url: meta.url,
      head: meta.headRefName,
      base: meta.baseRefName,
    },
    summary: { total, unresolved, outdated, loaded: normalized.length, truncated, degraded },
    threads: normalized,
  };

  if (FORMAT === 'markdown') {
    console.log(formatMarkdown(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Subcommand: digest
// ---------------------------------------------------------------------------
async function cmdDigest() {
  const inputPath = argVal('--input');
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('Error: --input file not found');
    process.exit(2);
  }

  let data;
  try { data = JSON.parse(fs.readFileSync(inputPath, 'utf8')); } catch {
    console.error('Error: Failed to parse input JSON');
    process.exit(2);
  }

  const all = process.argv.includes('--all');
  const budgetRaw = argVal('--budget');
  const budget = budgetRaw ? parseInt(budgetRaw, 10) : (all ? ALL_BUDGET : DEFAULT_BUDGET);
  if (!Number.isFinite(budget) || budget < 1 || budget > ALL_BUDGET) {
    console.error(`Error: --budget must be an integer between 1 and ${ALL_BUDGET}`);
    process.exit(2);
  }

  const { threads: redigested, truncated } = normalize(data.threads || [], { all, budget });

  const result = {
    ...data,
    summary: {
      ...data.summary,
      loaded: redigested.length,
      truncated,
    },
    threads: redigested,
  };

  if (FORMAT === 'markdown') {
    console.log(formatMarkdown(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Subcommand: writeback --plan
// ---------------------------------------------------------------------------
async function cmdWritebackPlan() {
  const inputPath = argVal('--input');
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('Error: --input file not found');
    process.exit(2);
  }

  let data;
  try { data = JSON.parse(fs.readFileSync(inputPath, 'utf8')); } catch {
    console.error('Error: Failed to parse input JSON');
    process.exit(2);
  }

  const threadIds = (argVal('--threads') || '').split(',').filter(Boolean);
  const allThreads = data.threads || [];
  const selected = threadIds.length > 0
    ? allThreads.filter(t => threadIds.includes(t.id))
    : allThreads;

  if (selected.length === 0) {
    console.error('Warning: No matching threads found for writeback plan');
    process.exit(1);
  }

  const lines = ['## Writeback Plan', ''];
  lines.push('| # | Thread | File | replyTargetId | Status |');
  lines.push('|---|--------|------|---------------|--------|');
  selected.forEach((t, i) => {
    const status = t.replyTargetId ? 'Ready' : 'Missing replyTargetId';
    lines.push(`| ${i + 1} | ${t.id} | ${t.path}:${t.line || '-'} | ${t.replyTargetId || 'N/A'} | ${status} |`);
  });

  const missing = selected.filter(t => !t.replyTargetId);
  if (missing.length > 0) {
    lines.push('');
    lines.push(`Warning: ${missing.length} thread(s) missing replyTargetId, cannot writeback`);
  }

  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Subcommand: writeback --execute
// ---------------------------------------------------------------------------
async function cmdWritebackExecute() {
  const threadId = argVal('--thread');
  const reply = argVal('--reply');
  const repoArg = argVal('--repo');
  const prArg = argVal('--pr');
  const replyTargetId = argVal('--replyTargetId');
  const shouldResolve = process.argv.includes('--resolve');

  if (!reply) {
    console.error('Error: --reply is required');
    process.exit(2);
  }
  if (!repoArg || !prArg) {
    console.error('Error: --repo and --pr are required');
    process.exit(2);
  }
  if (!replyTargetId || !/^\d+$/.test(replyTargetId)) {
    console.error('Error: --replyTargetId must be a numeric ID');
    process.exit(2);
  }

  const rp = parseRepoArg(repoArg);
  if (!rp) {
    console.error('Error: Invalid --repo format');
    process.exit(2);
  }

  // Build JSON body via jq, write to temp file, then use --input <file>
  const jqR = await runCapture('jq', ['-n', '--arg', 'body', reply, '{body:$body}']);
  if (jqR.code !== 0) {
    console.error('Error: jq failed to build reply body');
    process.exit(2);
  }

  const tmpFile = require('path').join(os.tmpdir(), `lpr-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(tmpFile, jqR.stdout, 'utf8');

  const replyR = await runCapture('gh', [
    'api', '--method', 'POST',
    `repos/${rp.owner}/${rp.repo}/pulls/${prArg}/comments/${replyTargetId}/replies`,
    '--input', tmpFile,
  ]);

  // Clean up temp file
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  if (replyR.code !== 0) {
    console.error(`Warning: Reply failed: ${replyR.stderr}`);
    process.exit(1);
  }

  console.log(`Reply posted to comment ${replyTargetId}`);

  // Resolve thread if requested
  if (shouldResolve && threadId) {
    const resolveR = await runCapture('gh', [
      'api', 'graphql',
      '-f', `query=mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }`,
      '-F', `id=${threadId}`,
    ]);
    if (resolveR.code !== 0) {
      console.error(`Warning: Resolve failed for ${threadId}: ${resolveR.stderr}`);
      process.exit(1);
    }
    console.log(`Thread ${threadId} resolved`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  switch (SUBCOMMAND) {
    case 'fetch':
      await cmdFetch();
      break;
    case 'digest':
      await cmdDigest();
      break;
    case 'writeback':
      if (process.argv.includes('--plan')) {
        await cmdWritebackPlan();
      } else if (process.argv.includes('--execute')) {
        await cmdWritebackExecute();
      } else {
        console.error('Error: writeback requires --plan or --execute');
        process.exit(2);
      }
      break;
    default:
      console.error('Error: Unknown subcommand. Use: fetch | digest | writeback');
      process.exit(2);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(2);
});
