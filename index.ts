/**
 * pi-pstack — thin adapter between pi's extension API and the harness module.
 *
 * Two responsibilities, both delegating entirely to deeper modules:
 *
 * 1. pstack harness: reads the vendored pstack sources, harness-core.ts
 *    generates the pi harness tree, resources_discover exposes its skills,
 *    /pstack-doctor reports problems.
 * 2. questionnaire tool: the pi example built out. questions-core.ts owns
 *    pure logic, questions-tui.ts owns the TUI component; this file wires
 *    them to pi.registerTool.
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adapt, check, type SourceTree, type FileEntry, type HarnessConfig } from "./harness-core.ts";
import {
	answerText,
	normalizeQuestions,
	resultView,
	type QuestionnaireResult,
	type QuizQuestion,
} from "./questions-core.ts";
import { buildQuestionnaire, type TuiTheme } from "./questions-tui.ts";

// ─── Paths ───────────────────────────────────────────────────────────────────

const PKG = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = join(PKG, "pstack");
const GENERATED = join(getAgentDir(), "pi-pstack-gen");
const ADAPTER_DOC_PATH = join(PKG, "harness-data", "pi.md");
const GENERATED_README_PATH = join(PKG, "harness-data", "generated-readme.md");
const GITHUB_BASE = "https://github.com/cursor/plugins";
const PREAMBLE_TEMPLATE =
	"In pi, read [the pi harness adapter](../../docs/harness/pi.md) once per session before you follow this skill. It maps the Cursor names in pstack skills to pi.";

const CFG: HarnessConfig = {
	adapterDocName: "pi",
	adapterDocText: readText(ADAPTER_DOC_PATH, ""),
	generatedReadmeText: readText(GENERATED_README_PATH, ""),
	preambleTemplate: PREAMBLE_TEMPLATE,
	githubBase: GITHUB_BASE,
};

function readText(path: string, fallback: string): string {
	try {
		return existsSync(path) ? readFileSync(path, "utf8") : fallback;
	} catch {
		return fallback;
	}
}

// ─── Source reading (the adapter's only fs) ──────────────────────────────────

function readSource(root: string): SourceTree {
	const tree: SourceTree = new Map();
	const walk = (dir: string, rel: string): void => {
		for (const name of readdirSync(dir).sort()) {
			if (name === ".DS_Store" || name === "node_modules" || name === ".git") continue;
			const abs = join(dir, name);
			const path = rel ? `${rel}/${name}` : name;
			if (statSync(abs).isDirectory()) walk(abs, path);
			else {
				const entry: FileEntry = {
					bytes: readFileSync(abs),
					executable: (statSync(abs).mode & 0o111) !== 0,
				};
				tree.set(path, entry);
			}
		}
	};
	walk(root, "");
	return tree;
}

function writeTree(files: SourceTree): void {
	rmSync(GENERATED, { recursive: true, force: true });
	for (const [path, entry] of files) {
		const abs = join(GENERATED, path);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, entry.bytes);
		chmodSync(abs, entry.executable ? 0o755 : 0o644);
	}
}

// ─── Questionnaire tool ──────────────────────────────────────────────────────

const QuestionnaireParams = Type.Object({
	questions: Type.Array(
		Type.Object({
			id: Type.String({ description: "Identifier you branch on later; still present in the returned text" }),
			label: Type.Optional(
				Type.String({ description: "One-word display name shown in the tab bar when asking 2+ questions (default Q1, Q2)" }),
			),
			prompt: Type.String({ description: "The question text as the user will read it — the ask alone; the TUI explains its own controls" }),
			options: Type.Array(
				Type.Object({
					value: Type.Optional(
						Type.String({ description: "Short stable token you branch on when the answer comes back (defaults to label)" })
					),
					label: Type.Optional(
						Type.String({ description: "The option text as the user will read it (defaults to value)" })
					),
					description: Type.Optional(
						Type.String({ description: "One-line helper below the option" }),
					),
					recommended: Type.Optional(
						Type.Boolean({ description: "Renders a Recommended badge next to the label. Exactly one option; keep it first, and say why in its description" }),
					),
				}),
				{ description: "2..6 concrete choices — each must change what you do next; every option needs a label or a value (they fill in for each other). Exactly one option carries recommended: true, and it sits first" },
			),
			allowOther: Type.Optional(
				Type.Boolean({ description: "Permit a free-text answer alongside the listed options (default true). Omit only when the user must pick one of the options" }),
			),
			multiSelect: Type.Optional(
				Type.Boolean({ description: "Accept several picks; the answer is the full set (default false = exactly one)" }),
			),
		}),
		{ description: "All blocking questions in one call — the user answers them in one pass. Returned text is one line per question: 'Label: user selected: N. Option label' or 'Label: user wrote: …'" },
	),
});

function registerQuestionnaire(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description:
			"When a decision blocks progress and its options can be enumerated (2..6 concrete choices), ask through this tool — one call, all blocking questions, recommended option first. Each question takes one pick by default; set multiSelect: true to let the user pick several. Triggers: clarifying requirements, getting preferences, confirming a choice. Wording rules live in the ask-questions skill; non-interactive runs (pi -p, subagent children) have no UI and error — ask in plain text there.",
		promptSnippet: "questionnaire: ask the user 1..n questions with options (recommended first)",
		parameters: QuestionnaireParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: "questionnaire needs an interactive UI (pi TUI). Non-interactive runs have no UI: ask in plain text instead, one question at a time.",
						},
					],
					details: { questions: [], answers: [], cancelled: true } as QuestionnaireResult,
				};
			}
			const { questions, error } = normalizeQuestions(params.questions as QuizQuestion[]);
			if (error || questions.length === 0) {
				return {
					isError: true,
					content: [{ type: "text", text: `Invalid questionnaire: ${error}` }],
					details: { questions: [], answers: [], cancelled: true } as QuestionnaireResult,
				};
			}

			const result = await ctx.ui.custom<QuestionnaireResult>(
				(tui, theme, _kb, done) =>
					buildQuestionnaire(tui, theme as unknown as TuiTheme, questions, done),
			);

			return { content: [{ type: "text", text: answerText(result) }], details: result };
		},

		renderCall(args, theme) {
			const qs = (args.questions as QuizQuestion[] | undefined) ?? [];
			const labels = qs.map((q) => q.label ?? q.id).join(", ");
			let text = theme.fg("toolTitle", theme.bold("questionnaire "));
			text += theme.fg("muted", `${qs.length} question${qs.length !== 1 ? "s" : ""}`);
			if (labels) text += theme.fg("dim", ` (${labels})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.cancelled) return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			const view = resultView(details);
			const lines: string[] = [];
			// Header: count first (success when complete), questions answered of asked.
			const answered = view.rows.length;
			const total = details.questions.length;
			const countLine = details.cancelled
				? "cancelled"
				: `${answered} of ${total} answered`;
			lines.push(
				`${theme.fg("toolTitle", theme.bold("# Questions "))}${theme.fg("success", countLine)}`,
			);
			for (const row of view.rows) {
				if (expanded) {
					lines.push("");
					lines.push(theme.fg("muted", row.prompt));
					lines.push(theme.fg("text", row.answer));
				} else {
					const mark = row.written ? theme.fg("muted", "wrote ") : "";
					lines.push(
						`${theme.fg("muted", "· ")}${theme.fg("text", mark + row.labelsJoined)}`,
					);
				}
			}
			if (!expanded && total > answered) {
				lines.push(theme.fg("dim", `· ${total - answered} unanswered`));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let problems: string[] = [];

	const generate = (): SourceTree => {
		problems = [];
		try {
			if (!existsSync(SOURCE_ROOT)) {
				problems = [
					`pi-pstack: the vendored pstack tree is missing at ${SOURCE_ROOT}; reinstall the package or run scripts/sync-pstack.mjs from a checkout.`,
				];
				return new Map();
			}
			const source = readSource(SOURCE_ROOT);
			const found = check(source, CFG.adapterDocText);
			if (found.length > 0) {
				problems = found;
				return new Map();
			}
			return adapt(source, CFG);
		} catch (error) {
			problems = [`pi-pstack: ${error instanceof Error ? error.message : String(error)}`];
			return new Map();
		}
	};

	pi.on("resources_discover", () => {
		const files = generate();
		if (files.size === 0) return {};
		writeTree(files);
		const skillPaths = [...files.keys()]
			.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path))
			.map((path) => join(GENERATED, path));
		return skillPaths.length > 0 ? { skillPaths } : {};
	});

	registerQuestionnaire(pi);

	pi.registerCommand("pstack-doctor", {
		description: "Report pi-pstack harness state and problems",
		handler: async (_args, ctx) => {
			generate();
			const message =
				problems.length === 0
					? `pi-pstack: healthy.\nSources: ${SOURCE_ROOT}\nGenerated tree: ${GENERATED}`
					: `pi-pstack problems (${problems.length}):\n${problems.join("\n")}`;
			await ctx.ui.notify(message, problems.length === 0 ? "info" : "error");
		},
	});
}
