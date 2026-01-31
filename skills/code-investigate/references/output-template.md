# Code Investigate Output Template

## Report Structure

```
┌────────────────────────────────────────┐
│ 1. Investigation Question              │
├────────────────────────────────────────┤
│ 2. Claude Perspective                  │
│    - Related files                     │
│    - Core logic                        │
│    - Data flow                         │
├────────────────────────────────────────┤
│ 3. Codex Perspective                   │
│    - Related files (independently found)│
│    - Core logic                        │
│    - Data flow                         │
├────────────────────────────────────────┤
│ 4. Consolidated Conclusion             │
│    - Agreement points                  │
│    - Divergence points (table)         │
│    - Final conclusion                  │
│    - Possible gaps                     │
└────────────────────────────────────────┘
```

## Standard Report Format

```markdown
# Code Investigation Report: [Topic]

## Investigation Question

[User's original question]

---

## Claude Perspective

### Related Files

| File                  | Purpose              |
| --------------------- | -------------------- |
| `src/service/xxx.ts`  | Main processing logic|
| `src/provider/yyy.ts` | External data source |

### Core Logic

[Claude's understanding, with key code snippets]

### Data Flow

[Claude's analysis: input -> processing -> output]

---

## Codex Perspective

### Related Files

| File                 | Purpose              | Note                  |
| -------------------- | -------------------- | --------------------- |
| `src/service/xxx.ts` | Main processing logic| Same as Claude        |
| `src/util/zzz.ts`   | Utility functions    | Not found by Claude   |

### Core Logic

[Codex's understanding]

### Data Flow

[Codex's analysis]

---

## Consolidated Conclusion

### Agreement Points

- [Finding both sides agree on 1]
- [Finding both sides agree on 2]

### Divergence Points

| Topic      | Claude            | Codex             |
| ---------- | ----------------- | ----------------- |
| [Topic 1]  | [Claude's view]   | [Codex's view]    |

### Final Conclusion

[Complete understanding after integration]

### Possible Gaps

- [Found by Codex but missed by Claude]
- [Aspects needing further investigation]
```

## Report Writing Principles

| Principle            | Description                              | Checklist                           |
| -------------------- | ---------------------------------------- | ----------------------------------- |
| Separate perspectives| Claude/Codex conclusions presented separately | Two perspectives have independent sections |
| Mark sources         | Each finding attributed to who found it  | Divergence table notes source       |
| Prioritize differences| Focus on presenting differing findings  | Divergence points have detailed explanation |
| Integrated summary   | Provide complete understanding at the end| Has final conclusion section        |
| Acknowledge gaps     | List potentially overlooked aspects      | Has possible gaps section           |

## Report Quality Checklist

| Check                | Standard                                |
| -------------------- | --------------------------------------- |
| Question is clear    | Investigation question clearly recorded |
| Views independent    | Claude/Codex conclusions not mixed      |
| File paths complete  | Using absolute paths                    |
| Code snippets relevant| Quoted code supports conclusions       |
| Differences explained| Divergence points explain why they differ|
| Conclusion actionable| Reader knows what to do next            |
