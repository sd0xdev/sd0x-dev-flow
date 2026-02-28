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

## Early Access Limitations

- CLI is Early Access (Catalyst License as of Feb 2026)
- Command surface may change before GA
- Some commands may not exist yet — check `obsidian <command> --help`
- If a command fails with "unknown command", the CLI version may be older
