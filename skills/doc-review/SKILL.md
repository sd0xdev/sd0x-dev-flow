---
name: doc-review
description: Document review knowledge base. Covers tech spec review, document audit, document refactoring.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Document Review Skill

## Trigger

- Keywords: review doc, document review, tech spec review, review-spec, doc-refactor, streamline doc

## When NOT to Use

- Code review (use codex-code-review)
- Test coverage review (use test-review)
- Just want to read a document (use Read directly)

## Commands

| Command             | Description            | Use Case          |
| ------------------- | ---------------------- | ----------------- |
| `/codex-review-doc` | Codex reviews .md docs | Document changes  |
| `/review-spec`      | Review tech spec       | Spec confirmation |
| `/doc-refactor`     | Streamline documents   | Doc too long      |
| `/update-docs`      | Research & update docs | After code change |

## Workflow

```
Detect .md changes -> Select review command -> Output review result + Gate
```

## Review Dimensions

| Dimension    | Checks                                          |
| ------------ | ------------------------------------------------ |
| Structure    | Heading hierarchy, paragraph organization, TOC   |
| Content      | Accuracy, completeness, consistency              |
| Code samples | Sample correctness, alignment with actual code   |
| Tech spec    | Requirements coverage, risk identification, test strategy |

## Verification

- Each issue tagged with severity level
- Gate is clear (✅ Pass / ⛔ Block)
- Fix suggestions are specific and actionable

## Required Actions

| Change Type | Must Execute                          |
| ----------- | ------------------------------------- |
| `.md` docs  | `/codex-review-doc` or `/review-spec` |
| Tech spec   | `/review-spec`                        |
| README      | `/codex-review-doc`                   |

## Examples

```
Input: Review this tech spec for me
Action: /review-spec -> Check completeness/feasibility/risks -> Output Gate
```

```
Input: This document is too long, streamline it
Action: /doc-refactor -> Tabularize + Mermaid -> Output comparison
```
