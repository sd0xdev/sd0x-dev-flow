# Dependency Graph Algorithm

## Edge Convention

**Direction**: dependency → dependent (A → B means "A is used by B")

```
A ──→ B    means B depends on A (B references /A in its body)
```

**Leaf skill**: in-degree 0 (no incoming edges = no dependencies on other skills)
**Root skill**: out-degree 0 (no outgoing edges = nothing depends on it)

## Dependency Detection

| Type | Regex Pattern | Example |
|------|--------------|---------|
| Skill reference | see scan-repo.js:270 | `/codex-review-fast` |
| Rule reference | `@rules/[a-z0-9_.-]+\.md` | `@rules/auto-loop.md` |
| MCP server | `mcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_-]+` | `mcp__example__tool` — the pattern still recognises MCP tools in a scanned project; this plugin no longer declares any of its own |
| Tool (frontmatter) | `allowed-tools:` comma-separated | `Read, Grep, Glob` |

## DAG Construction

```
Input: skills[] (each with name + dependencies.skills[])

1. nodes = unique skill names
2. For each skill S:
     For each dep D in S.dependencies.skills:
       If D in nodes AND D ≠ S:
         Add edge (D → S)
3. Return { nodes, edges }
```

## Cycle Detection: Tarjan's SCC

```
function tarjanSCC(nodes, edges):
  index = 0
  stack = []
  indices = {}    // node → discovery index
  lowlinks = {}   // node → lowest reachable index
  onStack = Set()
  sccs = []

  for each node v not yet visited:
    strongConnect(v)

  function strongConnect(v):
    indices[v] = lowlinks[v] = index++
    stack.push(v); onStack.add(v)

    for each (v → w) in edges:
      if w not visited:
        strongConnect(w)
        lowlinks[v] = min(lowlinks[v], lowlinks[w])
      else if w in onStack:
        lowlinks[v] = min(lowlinks[v], indices[w])

    if lowlinks[v] == indices[v]:
      scc = []
      do: w = stack.pop(); onStack.remove(w); scc.push(w)
      while w ≠ v
      if |scc| > 1: sccs.push(scc)

  return sccs  // only components with size > 1 (actual cycles)
```

## Hard Gate

| Condition | Action |
|-----------|--------|
| Any SCC with > 3 nodes | `needHuman: true` — flag for human review |
| SCC with 2-3 nodes | Collapse into single composite node, continue |
| No cycles | Normal processing |

## Topological Sort: Kahn's Algorithm

```
function kahnSort(nodes, edges, cycles):
  1. Collapse each cycle into representative node (first element)
  2. Rebuild edges with representatives
  3. Compute in-degree for each node
  4. Initialize queue with in-degree 0 nodes

  batches = []
  while queue not empty:
    batch = expand(queue)  // restore cycle members
    batches.push(batch)
    for each node n in queue:
      for each neighbor of n:
        in-degree[neighbor]--
        if in-degree[neighbor] == 0: next_queue.add(neighbor)
    queue = next_queue

  return batches  // [leaves, ..., roots]
```

## Batch Ordering

| Batch # | Content | Generation Order |
|---------|---------|-----------------|
| 1 | Leaf skills (no deps) | Generate first |
| 2 | Skills depending only on batch 1 | Generate second |
| ... | ... | ... |
| N | Root skills (everything depends on them) | Generate last |

## Example

```
Skills: A depends on nothing
        B depends on /A
        C depends on /A
        D depends on /B and /C

Edges: A→B, A→C, B→D, C→D

Leaf skills: [A]
Batches: [[A], [B, C], [D]]
```
