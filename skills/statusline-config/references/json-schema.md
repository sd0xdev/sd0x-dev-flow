# StatusLine JSON Schema

Claude Code pipes this JSON to your script's stdin on every update.

## Fields

| Field                                 | Type              | Description                               |
| ------------------------------------- | ----------------- | ----------------------------------------- |
| `model.id`                            | string            | `claude-opus-4-6`                         |
| `model.display_name`                  | string            | `Opus`                                    |
| `workspace.current_dir`               | string            | Current working directory                 |
| `workspace.project_dir`               | string            | Directory at session start                |
| `context_window.used_percentage`      | number\|null      | Pre-calculated context used %             |
| `context_window.remaining_percentage` | number\|null      | Pre-calculated context remaining %        |
| `context_window.context_window_size`  | number            | Total context window tokens               |
| `cost.total_cost_usd`                 | number            | Session cumulative cost (USD)             |
| `cost.total_duration_ms`              | number            | Wall-clock time (ms)                      |
| `cost.total_api_duration_ms`          | number            | API wait time (ms)                        |
| `cost.total_lines_added`              | number            | Lines added this session                  |
| `cost.total_lines_removed`            | number            | Lines removed this session                |
| `session_id`                          | string            | Unique session identifier                 |
| `version`                             | string            | Claude Code version                       |
| `vim.mode`                            | string\|undefined | `NORMAL`/`INSERT` (only when vim enabled) |
| `exceeds_200k_tokens`                 | boolean           | Whether input exceeds 200k threshold      |
| `output_style.name`                   | string            | Current output style                      |

## Null Handling

These fields may be `null` before the first API call:

- `context_window.used_percentage`
- `context_window.remaining_percentage`

Always use jq fallback: `jq -r '.field // 0'`
