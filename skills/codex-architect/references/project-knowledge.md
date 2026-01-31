# Project-Specific Architecture Knowledge

## Project Structure

```
src/
├── controller/     # API endpoints (thin layer)
├── service/        # Business logic (core)
├── provider/       # External service wrappers
├── entity/         # MongoDB models
├── interface/      # TypeScript interfaces
└── config/         # Configuration
```

## Common Architecture Decisions

| Decision Point | Options                | Project Convention       |
| -------------- | ---------------------- | ------------------------ |
| Cache Strategy | Redis / Local / Hybrid | Redis as primary         |
| Data Access    | Repository / Direct    | Mongoose direct queries  |
| Error Handling | Throw / Result Type    | Unified exception class  |
| DI             | Constructor / Property | @Inject() property injection |

## Output Report Template

```markdown
# Architecture Consulting Report

## Question

<User's question>

## Codex Advice

<Codex's full output>

## Claude's Perspective

<Claude's supplementary or differing opinions>

## Combined Recommendations

### Consensus Points

- Recommendations agreed upon by both

### Divergence Points

| Topic | Codex | Claude | Recommended |
| ----- | ----- | ------ | ----------- |

### Final Recommendation

<Integrated solution>
```

## Usage Scenarios

| Scenario              | Description                      | Mode    |
| --------------------- | -------------------------------- | ------- |
| Design new feature    | Design architecture from scratch | design  |
| Refactor existing system | Evaluate refactoring plan      | review  |
| Tech selection        | Choose tech stack/framework      | compare |
| Solution validation   | Validate existing solution       | review  |
| Performance optimization | Design optimization strategy  | design  |
| API design            | Design RESTful API               | design  |

## Workflow Integration

```
Design phase    -> /codex-architect    Get dual-perspective advice
    |
Planning phase  -> /tech-spec          Produce tech spec document
    |
Review phase    -> /review-spec        Review tech spec
    |
Implementation  -> /codex-implement    Codex writes code
    |
Code review     -> /codex-review-fast  Review code quality
```
