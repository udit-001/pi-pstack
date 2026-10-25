# pi-pstack

Lauren Tan's 58-skill workflow plugin — [pstack](https://github.com/cursor/plugins/tree/main/pstack) — for the [pi coding agent](https://github.com/earendil-works/pi). Install it, type `/skill:<name>`. Cursor terms map to pi; nothing runs until you type a command.

## Install

```bash
pi install git:github.com/udit-001/pi-pstack
```

1. Restart pi — the harness generates at startup.
2. `/skill:<name>` runs any pstack skill — `/skill:poteto-mode`, `/skill:why`, `/skill:unslop`.
3. `/pstack-doctor` checks harness health any time.

## What you get

- **58 skills as pi commands** — they stay out of automatic skill selection by design.
- **pstack's subagents** — `poteto-agent` and `comment-sicko` load into pi-subagents alongside your own; a pi-only `pstack-readonly` backs the `readonly: true` mapping.
- **Decision forks in one pass** — the `questionnaire` tool renders 1..n questions as a tabbed picker with confirmed answers.
- **Cursor-isms mapped** — every Cursor name in every skill has a row in the pi adapter (`docs/harness/pi.md`), enforced by tests; Cursor-only features (Automations, Bugbot) skip with a one-line note.
- **Name collisions handled** — your `tdd` wins the plain name; the pstack copy loads as `pstack-tdd`.

## Tests

```bash
npm test   # node --test: 16 harness invariants + 27 questionnaire tests
```

Port internals — the harness module, the questionnaire, vendoring, and the update workflow — are in [design.md](design.md). `automations/` needs the Cursor Automations runtime and is not ported.

## License

MIT, inherited from upstream pstack.
