# Native Feature Resolution (`/tech-spec`)

`/tech-spec` grants `Read, Grep, Glob, Bash(git:*), Write`. It has **no node permission**, so
`scripts/resolve-feature.js` is not a command it may run, and this file deliberately contains no
command it cannot execute — that is the whole reason it exists as a separate reference rather than
as a section of the shared algorithm.

There is a canonical shared reference describing the resolver, its payload schema and the four
document source sets. It is deliberately **not linked from here**: linking it would put a file full
of commands this skill cannot run back into this skill's reachable graph, which is the exact defect
the split was made to remove. `/tech-spec` needs a feature key and a canonical filename — nothing in
that payload. A skill that needs the sets grants `Bash(node:*)` and reads the shared reference
directly.

What follows is how `/tech-spec` obtains the same *feature key* from the tools it does have.

## The cascade, natively

| Level | Signal | How `/tech-spec` gets it | Confidence |
|-------|--------|--------------------------|------------|
| 1 | Explicit key | `$ARGUMENTS` — a `docs/features/<key>/` path is used directly; a bare keyword is the key | high |
| 2 | Branch name | `git branch --show-current`, matched against `^feat/([^/]+)$` | high |
| 3 | Changed paths — docs | `git diff --name-only HEAD`, matched against `^docs/features/([^/]+)/` — **the first matching path wins** | medium |
| 3b | Changed paths — skills | `^skills/([^/.]+)`, **but only if `docs/features/<key>/` exists** | medium |
| 4 | Single feature dir | `Glob` over `docs/features/*` — exactly one directory | low |
| — | Not found | none of the above | Gate: Need Human |

**Level 3 takes the first match, not the only one.** `feature-resolver.js:131` maps the changed
paths and takes the first that matches, so a diff touching two feature directories resolves to
whichever git printed first — which is alphabetical, not "the one being worked on". The condition
worth stating out loud is that this is *not* ambiguity handling: nothing reports the second
candidate. When a diff spans two features, pass `$ARGUMENTS` and resolve at level 1 instead of
letting level 3 pick.

**Level 3b's existence condition is load-bearing, and it is the one place this cascade is not a
straight simplification of the resolver.** `scripts/lib/feature-resolver.js:141` accepts a changed
`skills/<key>` path *only* when probing `docs/features/<key>/` succeeds; when it does not, it falls
through to level 4, and the negative behaviour is pinned by test. Dropping the condition changes the
answer rather than shortening it: editing `skills/new-skill/SKILL.md` with no matching feature
directory would resolve `new-skill`, find every spec glob empty, and create a spec for a feature
that does not exist. Levels 1–3 have no such condition — a key that resolves there is used whether
or not its directory exists.

**Slug validation is not optional for levels 1–3b**: `/^[a-z0-9][a-z0-9._-]*$/i`. It is what rejects
`../` and an absolute path arriving through `$ARGUMENTS`, and levels 2–3b feed it strings taken from
the environment (a branch name, a diff path) rather than from a validated source. **Level 4 is
deliberately not validated, in the resolver or here**: its candidate is a single path segment that
came from listing `docs/features/` itself, so there is no untrusted string to reject —
`feature-resolver.js:164` passes `dirs[0]` to `probe` directly.

**Level 4 is where this cascade and the resolver can legitimately disagree**, and the divergence is
in the listing, not in the logic: `readdirSync` returns dot-directories and `Glob("docs/features/*")`
does not. A corpus whose only entry is `docs/features/.archive/` therefore resolves at `low`
confidence in the resolver and not at all here. Native is the safer of the two answers — a
dot-directory is not a feature — so this is a difference to know about rather than one to close, and
it only ever arises for a repository with exactly one such directory and no ordinary one.

**What this does not produce**: `doc_inventory`, the four source sets, or `scan_error`. Those come
from the resolver, and `/tech-spec` consumes none of them — it needs a key and a canonical filename.
A skill that *does* need the sets grants `Bash(node:*)` and calls the wrapper.

## Canonical discovery

Resolving the key is half the job. Testing the single literal path `docs/features/<key>/2-tech-spec.md`
is the other half done wrong: a spec split into a numbered subfolder, or carrying a variant name,
reads as absent and a second spec gets created beside the real one.
`docs/features/auto-loop-evolution/2-tech-spec/2-tech-spec.md` is the live proof in this repo.

The `Glob` cascade and its ambiguity rule live in `../SKILL.md` § Context-Aware Mode — canonical
path → split folder → variant, minus the `-fp-brief.md` / `-tech-brief.md` suffixes that
`scripts/config/doc-taxonomy.json` excludes from the `tech-spec` type for the same reason. Two or
more remaining variant hits is ambiguity, not a match: name the candidates and take the Need Human
exit.

A `Glob` that errors, and a `<key>` that resolved at `low` confidence and matches nothing, are
**not** the same as "no spec exists". Say which of the two it was rather than dropping into create
mode.
