# pi-pstack — design

pstack (Lauren Tan's Cursor plugin, https://github.com/cursor/plugins/tree/main/pstack)
ported to pi.

## Read this first

Vocabulary is from the `codebase-design` skill (~/.agents/skills/codebase-design):
module, interface, implementation, depth, seam, adapter. Use those terms exactly.

## The module

**Module: `harness`** — everything needed to turn a pstack source tree into a
pi-loadable resource tree.

**Interface** (everything a caller must know to use the module correctly):

```ts
export interface FileEntry { bytes: Buffer; executable: boolean }
export interface SourceTree { files: Map<string, FileEntry> }   // relPath rooted at pstack/

export interface HarnessConfig {
  adapterDocName: string;   // e.g. "pi"
  adapterDocText: string;   // hand-authored doc/x.y.md content
  preambleTemplate: string; // one-line line the harness injects per skill's H1
}

export function adapt(source: SourceTree, cfg: HarnessConfig): SourceTree;
export function check(source: SourceTree, adapterDocText: string): string[];
```

- **`adapt`** — takes a full pstack source tree, returns the generated pi harness tree.
  Includes: relinking GitHub URLs in markdown, injecting the adapter-doc preamble into
  skill SKILL.md files that use Cursor names, dropping skills/ files never reachable
  in pi (e.g. `.cursor-plugin/`), assembling `docs/harness/pi.md` from harness-data,
  copying `agents/` files as-is, and relinking `.cursor` references in prose.
- **`check`** — invariant enforcement, run both at build time (as a bun test) and
  inline at runtime (as a hard assertion before `adapt` returns). Returns a list of
  human-readable problem strings; empty means clean. Enforces:
  1. every Cursor name (term) that appears in any SKILL.md under `skills/` also has a
     matching row in the pi harness adapter doc (zero Cursor terms without a row —
     same invariant upstream enforces against the claude-code adapter);
  2. skill folder name == SKILL.md frontmatter `name`;
  3. skills/dirs that need an injected preamble have an `# H1` heading in their SKILL.md
     (so injection lands in the right spot).

**Depth**: two functions, each takes/returns an in-memory tree (no fs, no pi API, no
pstack-version-specific knowledge). Small interface: 2 functions + 1 config type +
2 value types. Lots of behaviour hidden: file gathering, Cursor-term detection,
regex-canonical routes, markdown relinking, preamble injection, adapter-table lookup,
invariants. Depth per the codebase-design definition — most of the plugin's behaviour
sits behind `adapt`/`check`.

**Locality**: if pstack updates upstream, or the pi mapping changes, both live in
harness-core.ts (`TERMS` regexes) + harness-data/`pi.md` (the pi row table).
One change, re-verified by the `check` test.

**The interface is the test surface** — the tests in `harness-core.test.ts` exercise
`adapt`/`check` on synthetic and vendored-tree fixtures, no fs or pi needed. They
correspond 1:1 to the three `check` invariants plus preamble-injection behaviour plus
adapters-decoupling behaviour.

## The package (the thin adapter)

`index.ts` is the adapter at the *outer* seam — between pi's extension API and the
`harness` module. Its whole job:

1. read vendored `pstack/` from the package dir into memory (`SourceTree`),
2. hand `harness` its config (adapter doc text from `harness-data/`, preamble
   template, github base URL),
3. `adapt()` and `check()` (error hard if `check` finds anything),
4. write the generated tree to `~/.pi/agent/pi-pstack-gen/` (deterministic scratch
   dir under the agent dir; overwritten every `resources_discover`),
5. register a `pi.on("resources_discover")` handler that returns the generated skill
   paths so pi loads them as real resources, and a `/pstack-doctor` command that
   re-runs `check` and reports problems on demand.

Per codebase-design, this is a **thin adapter over the seam**: it owns no behaviour of
its own and exists to translate between pi's resource API and the harness module. All
complexity lives inside the harness module; the adapter is ~50 lines.

One adapter over the pi seam today. The seam earns its keep by the deletion test,
not the two-adapter rule: delete the harness module and every one of the 58 skills
re-derives its own Cursor-name handling — complexity reappears across many callers.
Upstream occupies the same seam for Claude Code with its generated harness tree.

## agents/ (pi-subagents agents)

Copies of pstack's two upstream agents (`poteto-agent.md`, `comment-sicko.md`) with
Cursor frontmatter/prose adapted to pi-subagents conventions:

- `is_background: true` dropped — pi-subagents agents run async by default.
- the model for `subagent_type: "poteto-agent"` becomes `agent: "poteto-agent"`,
  and a preamble line pointing the agent's prose at the generated pi harness adapter
  doc (`docs/harness/pi.md`) is added at the top of the body so the agent reads it
  before acting.

`agents/pstack-readonly.md` — a new, pi-only agent definition: Cursor skills ask for a
read-only child (`readonly: true`); we ship a `tools:`-restricted agent so the pi
harness adapter has a concrete row to point at for that Cursor term.

`agents/` is static, not generated: pi-subagents reads it from the package manifest
(`"pi": {"subagents": {"agents": ["./agents"]}}`) at load time.

## pstack/ (vendored)

The pstack source tree, vendored into this repo at `pstack/` (git clone → copied
files, no .git). Pinned at a commit (`PINNED_COMMIT`); updated by
`node scripts/sync-pstack.mjs [ref]`. Vendoring is deliberate: it makes `pi install
git:github.com/udit-001/pi-pstack` work zero-config (pi clones the whole repo, so
vendored pstack ships with the install), and keeps the references in the generated
tree honest.

## Generated-tree layout

```
~/.pi/agent/pi-pstack-gen/
├── skills/<name>/…       58 pstack skills, adapted
├── agents/…              upstream agents copied alongside for relative links
├── docs/guide/…          pstack guide (referenced by poteto-help)
├── docs/harness/pi.md    the hand-authored pi adapter doc
├── PI-HARNESS.md         generated-tree note
├── README.md             upstream pstack README (skills link to ../README.md)
└── LICENSE               upstream MIT license
```

## Files the harness does NOT generate (deliberate omissions)

- `plugin.json` (Cursor/Claude manifest) — pi uses pi-pstack's own `package.json`
  `pi` manifest instead.
- `.cursor-plugin/` — Cursor-only, never loaded.
- `automations/` — Cursor Automations runtime, not portable. Documented as a
  skip; anything pi-shaped would need a rebuild (pi-subagents missions), not a copy.
- `assets/` — logo/metadata only.

## The error surface

`check` returns human-readable problem strings so failures are debuggable at the
seam — never thrown as bare errors, never swallowed. `index.ts` turns a non-empty
list into one thrown Error naming every problem. Deps don't hide: the harness
module never imports pi or fs.

## Verified (this build)

- `npm test` — 30 pass (13 harness + 17 questionnaire), strict-clean under tsc.
- `pi -e . -p` — extension loads, `~/.pi/agent/pi-pstack-gen/` populated, `setup-pstack`
  the one auto-invocable catalog entry (57 command-only skills as designed).
- `/pstack-doctor` renders the healthy state dialog.
- `/skill:poteto` autocompletes pstack skills in the TUI.
- `subagent({agent: "poteto-agent", task: …})` runs and returns the child's output.

The questionnaire tool (see [design-questions.md](design-questions.md)) ships after
a TUI bugfix to the pi example: the example's `handleInput` returned early on the
submit tab because `currentQuestion()` is undefined there; this module checks
`onSubmitTab` before asking for the current question. `skills/ask-questions/` is
a package-root skill (pi vocabulary), deliberately outside the vendored tree so
the pin invariant keeps scanning only upstream skills.

## Rejected framings

- **"Component"/"service" language**: not used; per codebase-design glossary these
  words obscure the module's role.
- **A build script that regenerates the tree at dev time then commits it**
  (upstream's `harness/pstack/` approach): pi's `resources_discover` makes runtime
  generation natural and keeps the vendored tree the sole source of truth,
  eliminating drift between committed artifacts and sources. The generated tree is
  never a hand-reviewed artifact — it is always derived and re-derived.
