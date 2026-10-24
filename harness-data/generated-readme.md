# pi-pstack generated tree

This folder is generated from the pstack sources vendored inside the pi-pstack package (`<package>/pstack/`) by its pi extension at session start (pi's dynamic `resources_discover` mechanism). Do not edit it by hand; edit the vendored sources or `harness-data/` in the package, then run `/reload`.

## What is in here

- `skills/` — every pstack skill, adapted for pi: most carry a line under their H1 pointing at the pi harness adapter, and relative links into paths this tree omits (Cursor automations, assets) relink to the GitHub `main` URLs instead.
- `docs/` — the pstack guide and harness docs, plus `docs/harness/pi.md`, the hand-authored pi adapter mapping every Cursor term to its pi equivalent.
- `agents/` — upstream pstack agent definitions, adapted to pi-subagents frontmatter.
- `PI-HARNESS.md` — this file.
- `README.md`, `LICENSE` — the upstream pstack README and license, vendored.

## Install

```bash
pi install git:github.com/udit-001/pi-pstack
```

Run `/pstack-doctor` any time to check the vendored sources and the adapter coverage. Skills surface as `/skill:<name>` (pi keeps `disable-model-invocation` skills out of automatic selection).
