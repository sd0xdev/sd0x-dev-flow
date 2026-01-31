# Document Numbering Rules

## Feature Document Structure

Each feature's documents are numbered by development phase, stored in `docs/features/<feature>/`.

```
docs/features/<feature>/
├── 0-feasibility-study/         # Feasibility study (folder or single file)
│   ├── 0-feasibility-study.md   #   Main document
│   └── N-<sub-topic>.md         #   Sub-study
├── 1-requirements.md            # Requirements spec (if applicable)
├── 2-tech-spec.md               # Technical spec
├── 3-architecture.md            # Architecture design
├── 4-implementation.md          # Implementation notes (if applicable)
└── requests/                    # Request docs (unnumbered)
    └── YYYY-MM-DD-<title>.md
```

## Numbering Rules

| Rule       | Description                                                              |
|------------|--------------------------------------------------------------------------|
| Format     | `<N>-<kebab-case-name>.md`                                               |
| Start      | `0` = Feasibility study (earliest phase)                                 |
| Order      | Reflects development phase order, not priority                           |
| Gap allowed| Allowed (e.g., 0, 2, 3 skipping 1), indicates phase not applicable      |
| Sub-files  | When multiple files in same phase, create subfolder (e.g., `0-feasibility-study/`) |
| Sub-numbering | Files within folder also use numeric prefix (`0-main.md`, `1-sub.md`) |

## Standard Phases

| Number | Phase              | Output Command       | Required    |
|--------|--------------------|---------------------|-------------|
| 0      | Feasibility study  | `/feasibility-study` | Recommended |
| 1      | Requirements spec  | -                    | As needed   |
| 2      | Technical spec     | `/tech-spec`         | Required    |
| 3      | Architecture design| `/deep-analyze`      | Recommended |
| 4+     | Implementation/Appendix | -               | As needed   |

## Cross-References

Use **relative paths** for inter-document references:

```markdown
<!-- Same level reference -->
See [Technical Spec](./2-tech-spec.md)

<!-- Subfolder -> parent -->
See [Technical Spec](../2-tech-spec.md)

<!-- Parent -> subfolder -->
See [Feasibility Study](./0-feasibility-study/0-feasibility-study.md)
```

## Prohibited

- ❌ Unnumbered feature docs (`tech-spec.md`) — Must have numeric prefix
- ❌ Date prefixes (`2026-01-30-tech-spec.md`) — Date prefixes are only for `requests/`
- ❌ Uppercase or underscores (`2_Tech_Spec.md`) — Use kebab-case consistently
