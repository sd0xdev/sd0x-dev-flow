# Codex Architecture Research Prompt

Dispatched in Phase 1 Track C per `@skills/codex-code-review/references/codex-transport.md` § Start.

DESIGN_RECORD_PATH is `docs/features/<key>/` joined with the `file` of the tech-spec entry
`SKILL.md` selects from `design_records` — its four candidate cases, and **not** `canonical_docs.tech_spec`,
which is role-blind. When that selection finds **no** such entry, pass the literal string
`(none — do not read a spec)` rather than a guessed path: a Codex told to find the spec itself will
find whichever file is named like one.

`scan_error !== false` is **not** one of the cases this reference handles. `SKILL.md` § Phase 0 takes
the ⚠️ Need Human exit there, so Track C is never reached and there is no prompt to fill in — an
earlier version of this paragraph offered a substitute value for it, which read as permission to
continue into a Codex research pass on a corpus nobody could enumerate.

You are a senior software architect. Provide architecture recommendations for the feature described below.

## Feature Context

- Feature: ${FEATURE_KEY}
- Tech spec (design record): ${DESIGN_RECORD_PATH}
- Related files: ${RELATED_FILES}

## ⚠️ Important: You must independently research the project ⚠️

You **must** read the actual code and project structure yourself. Do NOT rely on the context above alone.

### Git Exploration (Priority)

1. Check change status: `git status`
2. Check changed files: `git diff --name-only HEAD`
3. Check full changes for specific file: `git diff HEAD -- <file-path>`
4. Read changed files to the end: `cat <changed file>` (chunk with `sed -n` when long)
5. Check the project structure, discovered rather than assumed: `ls` at the repository root, then the directories it actually shows — do not assume a `src/` layout; many repositories, this one included, have none
6. Read architecture docs: `cat docs/architecture.md | head -100`
7. Read the tech spec **at the path given above**, when one is given:
   `cat ${DESIGN_RECORD_PATH}` (chunk with `sed -n` when long). Do not go looking for it by name — the resolver already
   chose it from `design_records`, and the filename does not identify the role. A feature can hold a
   `2-tech-spec.md` that has been marked a history record beside a `2-tech-spec-v2.md` that is the
   live design, and listing the directory picks the wrong one of the two
8. Trace related modules: `cat <related file> | head -150`

### Project Research

- Search for integration patterns: `grep -r "import.*${FEATURE_KEY}" . -l --include="*.ts" --include="*.js" --include="*.md" | head -10`
- Find similar architecture patterns: `grep -r "flowchart\|sequenceDiagram" docs/ --include="*.md" -l | head -5`
- Read existing component implementations: `cat <file> | head -100`

## Architecture Analysis Required

Provide independent recommendations for:

1. **Component boundaries** — What are the natural module boundaries?
2. **Data flow** — How does data move through the system?
3. **Integration points** — Where does this feature connect to existing systems?
4. **Key design decisions** — What architecture choices matter most?
5. **Risks** — What could go wrong architecturally?

## Output Format

### Component Recommendations

| Component | Responsibility | Rationale |

### Data Flow Analysis

<describe primary flow>

### Integration Assessment

| Integration Point | Risk Level | Notes |

### Architecture Risks

| Risk | Impact | Recommendation |
