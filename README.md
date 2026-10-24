# pi-pstack

[pstack](https://github.com/cursor/plugins/tree/main/pstack), ported to [pi](https://pi.dev). Lauren Tan's 58-skill workflow plugin — `/poteto-mode`, `/why`, `/unslop`, `/tdd` and the rest — runs in the pi coding agent, with its subagents and a hand-checked map from Cursor terms to pi.

## Install

```bash
pi install git:github.com/udit-001/pi-pstack
```

## What you get

- **Run 58 pstack skills** as pi commands — type `/skill:<name>` (they stay out of automatic selection by design): `/skill:poteto-mode`, `/skill:why`, `/skill:unslop`.
- **Spawn pstack's subagents** — `poteto-agent` and `comment-sicko` load into [pi-subagents](https://github.com/nicobailon/pi-subagents) alongside your existing agents; a pi-only `pstack-readonly` backs the `readonly: true` mapping.
- **Answer decision forks in one pass** — the `questionnaire` tool renders 1..n questions as a tabbed picker with confirmed answers; `ask-questions` teaches the agent when to reach for it (recommended option first).
- **Get Cursor-isms mapped** — every Cursor name in every skill has a row in the pi harness adapter (`docs/harness/pi.md`, enforced by tests); Cursor-only features (Automations, Bugbot, cloud agents) skip with a one-line note.
- **Check the harness** — `/pstack-doctor` reports the health of the vendored sources and adapter coverage any time.

Skills install read-only and inert: nothing runs until you type the command. Name collisions with your own skills (say, your `tdd`) keep the first discovered and warn; filter per-package in `pi config` if that bites.

## Tests

```bash
npm test   # node --test: 13 harness invariants + 17 questionnaire tests, no TUI needed
```

The money test runs `check()` against the vendored upstream tree and the hand-authored pi adapter doc — upstream's own CI invariant ("no Cursor name without an adapter row") applied to pi.

Port internals — the harness module, the questionnaire module, generated-tree design, vendoring, and the update workflow (`scripts/sync-pstack.mjs`) — are documented in [design.md](design.md) and [design-questions.md](design-questions.md).

## Not ported

`automations/` (benny, Slack triage) needs the Cursor Automations runtime. The pi-shaped equivalent would be pi-subagents missions — a rebuild, not a copy.

## License

MIT, inherited from upstream pstack.
