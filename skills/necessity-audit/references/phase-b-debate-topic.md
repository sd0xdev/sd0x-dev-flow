# Phase B — Codex adversarial debate

## Invocation (MANDATORY)

Use `Skill("codex-brainstorm", <topic>)`. Never dispatch the transport directly for Phase B — the codex-brainstorm skill enforces bilateral stance tracking + Nash equilibrium detection.

## Topic construction

```bash
node scripts/skills/necessity-audit/debate-topic.js build \
  --preflight <preflight.json> \
  --output <topic.md>
```

The topic (see `debate-topic.js::buildTopic`):

| Section | Content |
|---------|---------|
| Active dimensions | Only the dims from `preflight.activeDimensions` (depth-filtered) |
| Termination preference | `deep` → Nash REQUIRED; `brief`/`normal` → any termination |
| Independent research | `cat <relPath>`, `ls docs/features/<featureKey>/`, `git grep -lE "<featureKey>" -- . ':(exclude)docs/**' ':(exclude)**/*.md'` |
| Classification contract | `[VERDICT: Keep\|Review\|Cut] <id> — <rationale> — Evidence: <file:line\|doc:§>` |
| Forbidden | Do NOT reveal Claude's Phase-A classifications — Codex must classify independently |

## Response parsing

```bash
node scripts/skills/necessity-audit/debate-topic.js parse \
  --input <raw-response.txt> \
  --output <debate.json>
```

Extracted fields (see `parseDebateResponse`):

| Field | Source |
|-------|--------|
| `threadId` | `/threadId['":\s]+[0-9a-f-]{20,}/i` |
| `rounds` | `/(\d+) rounds?/i` |
| `equilibriumReached` | `/nash equilibrium\|equilibrium reached/i` |
| `conclusion` | `## Conclusion` section body |
| `perElementVerdicts` | `[VERDICT: ...] <id> — <rat> — Evidence: <ev>` lines (tolerates leading whitespace, bullets, em-dashes in rationale) |
| `evidenceCitations` | verdict-tail + prose-external `file:line` / `doc:§` — id-tagged when from verdict, global otherwise; deduped by type + location + elementId |

## Greenfield mode

When `preflight.greenfield === true`, evidence format is `doc:§<section> [REASONING-ONLY]` — Codex debates via spec logic alone, no code grep.
