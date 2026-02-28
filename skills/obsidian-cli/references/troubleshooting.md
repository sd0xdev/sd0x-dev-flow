# Obsidian CLI Troubleshooting

## Preflight Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `CLI not found` | Not in PATH or not enabled | Settings > General > CLI; add to PATH |
| `CLI not responding` | Desktop app not running | Launch Obsidian desktop app |
| `No vault found` | No vault open or wrong default | Open vault in app, or `--vault <name>` |
| `Command timed out` | IPC hang (known EA issue) | Restart Obsidian; avoid piping search to `head` |

## macOS PATH Setup

If `obsidian` is not in PATH after enabling:

```bash
# Check if the binary exists in the app bundle
ls /Applications/Obsidian.app/Contents/MacOS/obsidian

# Add to PATH (add to ~/.zshrc for persistence)
export PATH="/Applications/Obsidian.app/Contents/MacOS:$PATH"
```

The preflight script auto-detects the macOS app bundle path as fallback.

## IPC Hang Workaround

Obsidian CLI v1.12 has a known issue: `search` commands hang when piped to `head`.

**Workaround**: The exec script uses `timeout` to bound all CLI calls. If timeout triggers (exit 124), restart Obsidian and retry.

## Vault Resolution Issues

| Scenario | Resolution |
|----------|------------|
| Multiple vaults open | Use `--vault` to specify explicitly |
| Vault moved/renamed | Update config: `/obsidian-cli --vault "New Name"` |
| Config stale | Delete `~/.sd0x/obsidian-cli.env` and reconfigure |

## CLI Exit Code Unreliable

Obsidian CLI v1.12 returns exit code 0 even on errors (e.g., `read` on a non-existent file prints `Error: File "..." not found.` but exits 0). The exec script checks output content instead of relying on exit codes:

- **File not found**: Single-line `read` output matching `^Error: File .* not found\.$` → triggers `create`
- **All other `read` output**: Treated as file content (including single-line notes starting with `Error:`) → triggers `append`
- **Mutating command validation**: After `create` or `append`, output is checked for `^Error:` to catch real CLI errors (vault/IPC/permission)

Additionally, `create` on an existing file does not fail — it creates a duplicate with `1` suffix (e.g., `note 1.md`). The exec script uses `read` output check to determine file existence before choosing `create` vs `append`.

## Early Access Limitations

- CLI is Early Access (Catalyst License as of Feb 2026)
- Command surface may change before GA
- Some commands may not exist yet — check `obsidian <command> --help`
- If a command fails with "unknown command", the CLI version may be older
