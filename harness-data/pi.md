# pstack in pi

Read this file once per session before you follow any pstack skill. It maps the Cursor names in pstack skills to pi. `<pstack>` means the folder that holds `skills/` and `docs/` inside the installed pi-pstack package (upstream sources, vendored). The generated harness tree lives next to the package and carries an adapted copy of every skill. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

## Tools

| Cursor | pi |
| --- | --- |
| `Task` | `subagent` (pi-subagents). One child: `{agent, task}`. Several independent children: one `subagent` workflow call with `workflow: "parallel"`. Dependent multi-step work: one top-level `subagent` call with `async: true` on an async `workflow`. |
| `AskQuestion` | The `questionnaire` tool (pi-pstack). One call covers 1..n questions — options with descriptions, free text via the default "Type something" option, recommended option first. In non-TUI runs (`pi -p`, subagent children) it errors; ask in plain text, one question at a time. The `ask-questions` skill (pi-pstack) holds the trigger rules. |
| todolist | pi's `todo` tool. Open a `todo` entry per playbook step and close it as you go. |
| Run another pstack skill (`/name` or "the **name** skill") | `Read` `<pstack>/skills/<name>/SKILL.md` and follow it. In pi most pstack skills stay out of automatic skill selection, and the user invokes them as `/skill:<name>`. When you tell the user to type it, write `/skill:<name>`. |
| `Grep`, `Glob` | pi has `read` and `bash`; use `grep`/`rg` through `bash`. |

## Subagent fields

| Cursor | pi |
| --- | --- |
| `subagent_type: generalPurpose` | `agent: "delegate"` (pi-subagents general delegate). |
| `poteto-agent`, `comment-sicko` | "poteto-agent", "comment-sicko" (pi-pstack ships both; names unchanged). |
| `readonly: true` | `agent: "pstack-readonly"` (pi-pstack ships it; `tools: read, grep, find, ls, bash`). Also say "do not edit files" in the brief, then check `git` status afterward. |
| `readonly: false` | Any editing agent; "delegate" is the default general one. The child keeps the session's MCP tools. |
| `environment: "cloud"` | `worktree: true` on the `subagent` workflow call. Name the branch or commit the worker checks out. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | Tell the worker to check out `<b>` first. |
| `run_in_background: true` | Omit. pi subagents run async by default and wake the parent on completion. |
| `resume` | Spawn a new agent and paste the earlier result into its brief. |
| `file_attachments` | List the paths in the brief. |

## Models

| Cursor | pi |
| --- | --- |
| `claude-` family slugs, such as `claude-opus-5-5-xhigh` | Use the closest matching model id your pi session has for that provider and family. Pass `model: "<provider>/<id>"` on the `subagent` call, and append the effort as `:<effort>`: `claude-opus-5-5-xhigh` is `model: "anthropic/claude-opus-4-5:xhigh"`. If you are unsure of the exact id, omit `model` and say so. |
| A `grok-` or `gpt-` slug, or any other non-Claude slug | Omit `model` so the agent runs on the session default model, and say so. |
| `auto` or `inherit-parent` | Omit `model`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | pi has no always-applied rule file. If the role value is missing from this table, omit `model` and use the skill's stated default. A user can hand-write `~/.pi/agent/pstack-models.md` and reference its role lines from `~/.pi/agent/AGENTS.md`; setup writes that file with no frontmatter, the `# budget` line, and one line per role, and it is not auto-loaded. |
| A role value `<model> <effort>`, such as `opus high` | `model: "<provider>/<opus id>:high"`. Effort is the last token, so the budget step works as written. |

## setup-pstack

pi has no always-applied rules directory, so `setup-pstack` writes its model choices to `~/.pi/agent/pstack-models.md`. Follow its steps with these changes:

- Detect. The detected models are the `provider/<id>` values pi lists (run without arguments the picker shows them). Write a real model as `<provider>/<id> <effort>`.
- Defaults. Best effort per the Models table.
- Write. Write `~/.pi/agent/pstack-models.md` with no frontmatter, then the comment lines, the `# budget` line, and one line per role from step 5. Overwrite the whole file. Never put role lines in `AGENTS.md`. Tell the user the file is not auto-loaded; they decide how to reference it.

## Paths

| Cursor | pi |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | pi skills are discovered from pi packages and the agent directory (`~/.pi/agent/skills/`, project `.pi/`). pstack skills arrive through the generated harness tree; there is no per-plugin skills override dir to consult. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `~/.pi/agent/npm/node_modules/pi-pstack/`, manifest = the `pi` key of pi-pstack's `package.json`. |
| `.cursor/rules/*.mdc`, always-applied rules | pi has no rules files. Use the project `AGENTS.md`, or the agent-directory `AGENTS.md` for global standing orders. The pstack-models rule is the exception, see Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | The vendored `<pstack>/<path>` inside the pi-pstack package when that file exists. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | pi-subagents writes each child run's status, logs, and artifacts under its managed run directory; the `subagent` result and its output references name the paths. Read only the run paths the parent gave you. |

## Cursor-only features

pi has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in pi: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | pi |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status. |
| A built-in PR tool | Use the forge command the step gives, such as `gh pr create`. That is not a skip, so write no line. |

## Vendored copy

The pi-pstack package vendors the upstream pstack tree at `<package>/pstack/` and generates the adapted skill tree you are reading into `~/.pi/agent/pi-pstack-gen/` at session start. A relative link that does not resolve inside the generated tree points at GitHub `main` on purpose; read the vendored copy for content, the URL for sharing.
