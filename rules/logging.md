# Logging Rules

Log levels: error (immediate action) | warn (potential issue) | info (business event) | debug (debugging)

Never log: Private keys | Mnemonics | API keys | Passwords | Full addresses (may log first/last 6 chars)

Must include: traceId | service | method

Format: JSON structured logs
