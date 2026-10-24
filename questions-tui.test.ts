import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	buildQuestionnaire,
	type QuestionnaireHarness,
	type TuiTheme,
} from "./questions-tui.ts";
import {
	normalizeQuestions,
	type QuestionnaireResult,
	type QuizQuestion,
} from "./questions-core.ts";

// Minimal theme stub: plain text, no ANSI. Width arithmetic doesn't care.
const theme: TuiTheme = {
	fg: (_c, t) => t,
	bg: (_c, t) => t,
	bold: (t) => t,
};

// No-op tui stub. The harness only calls requestRender().
const tui = { requestRender() {} };

// Editor consumes raw key data via matchesKey; accept sequences by hand.
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const TAB = "\t";
const BACKTAB = "\x1b[Z";
const ESC = "\x1b";
const ENTER = "\r";

const multiQs = (): QuizQuestion[] =>
	normalizeQuestions([
		{
			id: "scope",
			label: "Scope",
			prompt: "How much scope?",
			options: [
				{ value: "min", label: "Minimal" },
				{ value: "full", label: "Full" },
			],
		},
		{
			id: "priority",
			prompt: "Priority?",
			options: [{ value: "high", label: "High" }],
		},
	]).questions;

function harnessFor(qs: QuizQuestion[], submit: (r: QuestionnaireResult) => void): QuestionnaireHarness {
	return buildQuestionnaire(tui, theme, qs, submit);
}

describe("buildQuestionnaire (single question)", () => {
	test("first Enter submits the highlighted option", () => {
		let out!: QuestionnaireResult;
		const h = harnessFor(normalizeQuestions([{ id: "one", prompt: "p", options: [{ value: "a", label: "Alpha" }] }]).questions, (r) => {
			out = r;
		});
		h.handleInput(ENTER);
		assert.equal(out.cancelled, false);
		assert.deepEqual(out.answers, [
			{ id: "one", values: ["a"], labels: ["Alpha"], wasCustom: false, indexes: [1] },
		]);
	});

	test("Esc cancels", () => {
		let out!: QuestionnaireResult;
		const h = harnessFor(normalizeQuestions([{ id: "one", prompt: "p", options: [{ value: "a", label: "Alpha" }] }]).questions, (r) => {
			out = r;
		});
		h.handleInput(ESC);
		assert.equal(out.cancelled, true);
		assert.deepEqual(out.answers, []);
	});
});

describe("buildQuestionnaire (multiSelect)", () => {
	const multiSelQs = (): QuizQuestion[] =>
		normalizeQuestions([
			{
				id: "hobbies",
				label: "Hobbies",
				prompt: "Which hobbies do you enjoy?",
				multiSelect: true,
				options: [
					{ value: "read", label: "Reading" },
					{ value: "game", label: "Gaming" },
					{ value: "hike", label: "Hiking" },
				],
			},
		]).questions;

	test("Enter toggles; Enter again untoggles", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiSelQs(), (r) => results.push(r));
		h.handleInput(ENTER); // toggle Reading
		assert.equal(h.state().answeredCount, 1);
		h.handleInput(ENTER); // untoggle from the same row
		assert.equal(h.state().answeredCount, 0);
		assert.deepEqual(results, []);
	});

	test("free text composes with picks; single-question submit carries both", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiSelQs(), (r) => results.push(r));
		h.handleInput(ENTER); // Reading [x]
		h.handleInput(DOWN);
		h.handleInput(ENTER); // Gaming [x]
		h.handleInput(DOWN);
		h.handleInput(DOWN);
		h.handleInput(DOWN); // "Type something." row
		h.handleInput(ENTER); // open editor
		h.handleInput("larping");
		h.handleInput(ENTER); // commit write (multiSelect stays on the question)
		h.handleInput(ENTER); // finish: Enter on the written row
		const a = results[0]!.answers[0]!;
		assert.deepEqual(a.values, ["read", "game", "__other__"]);
		assert.deepEqual(a.labels, ["Reading", "Gaming", "larping"]);
		assert.deepEqual(a.indexes, [1, 2, undefined]);
		assert.equal(a.wasCustom, true);
	});

	test("checkbox rows show picked state; help line says toggle", () => {
		const h = harnessFor(multiSelQs(), () => {});
		h.handleInput(ENTER); // Reading on
		const text = h.render(80).join("\n");
		assert.ok(text.includes("[✓] Reading"), text);
		assert.ok(text.includes("[ ] Gaming"), text);
		assert.ok(text.includes("Enter toggle"), text);
	});

	test("untoggle leaves the written answer standing; submit reflects it", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiSelQs(), (r) => results.push(r));
		h.handleInput(ENTER); // Reading on
		h.handleInput(DOWN); h.handleInput(DOWN); h.handleInput(DOWN); // other row
		h.handleInput(ENTER);
		h.handleInput("larping");
		h.handleInput(ENTER); // commit write (stays on question)
		h.handleInput(BACKTAB); // single question: backtab still leaves the input safely
		// focus parked on the written row via seedFocus
		h.handleInput(UP); h.handleInput(UP); h.handleInput(UP); // up to Reading
		h.handleInput(ENTER); // toggle Reading OFF
		assert.equal(h.state().answeredCount, 1); // the write stands alone
		h.handleInput(DOWN); h.handleInput(DOWN); h.handleInput(DOWN); // back to written row
		h.handleInput(ENTER); // finish on the written row
		assert.equal(results.length, 1);
		const a = results[0]!.answers[0]!;
		assert.deepEqual(a.values, ["__other__"]);
		assert.deepEqual(a.labels, ["larping"]);
		assert.deepEqual(a.indexes, [undefined]);
	});
});

describe("buildQuestionnaire (multi-question)", () => {
	test("answers advance to the next tab, then the submit tab confirms", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiQs(), (r) => results.push(r));

		h.handleInput(ENTER); // answer Q1 with option 1 (Minimal)
		assert.equal(h.state().currentTab, 1);
		h.handleInput(ENTER); // answer Q2 (High — only option)
		assert.equal(h.state().currentTab, 2); // submit tab
		assert.equal(h.state().answeredCount, 2);
		h.handleInput(ENTER); // confirm
		assert.equal(results.length, 1);
		assert.equal(results[0]!.cancelled, false);
		assert.deepEqual(results[0]!.answers.map((a) => a.values), [["min"], ["high"]]);
	});

	test("down arrow changes the highlighted option", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiQs(), (r) => results.push(r));
		h.handleInput(DOWN);
		h.handleInput(ENTER);
		h.handleInput(ENTER);
		h.handleInput(ENTER);
		const a0 = results[0]!.answers[0]!;
		assert.deepEqual(a0.values, ["full"]);
		assert.deepEqual(a0.indexes, [2]);
	});

	test("free-text option enters input mode; editor onSubmit is wired through", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiQs(), (r) => results.push(r));
		h.handleInput(DOWN); // move to the appended "Type something."
		h.handleInput(DOWN);
		h.handleInput(ENTER); // choose Other
		assert.equal(h.state().inputMode, true);
		h.handleInput("typed by the user"); // flows into the editor
		h.handleInput(ENTER); // editor submit -> advances to Q2
		assert.equal(h.state().inputMode, false);
		h.handleInput(ENTER); // answer Q2 (only option) -> submit tab
		h.handleInput(ENTER); // confirm on submit tab
		const custom = results[0]!.answers[0]!;
		assert.equal(custom.wasCustom, true);
		assert.deepEqual(custom.values, ["__other__"]);
		assert.deepEqual(custom.labels, ["typed by the user"]);
	});

	test("Esc on a question tab cancels the whole questionnaire", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiQs(), (r) => results.push(r));
		h.handleInput(ESC);
		assert.equal(results[0]!.cancelled, true);
	});

	test("submit tab blocks Enter until every question is answered", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiQs(), (r) => results.push(r));
		// Jump to the submit tab without answering.
		h.handleInput(TAB);
		h.handleInput(TAB);
		assert.equal(h.state().currentTab, 2);
		h.handleInput(ENTER);
		assert.equal(results.length, 0);
	});

	test("input is ignored after submit", () => {
		const results: QuestionnaireResult[] = [];
		const h = harnessFor(multiQs(), (r) => results.push(r));
		h.handleInput(ENTER);
		h.handleInput(ENTER);
		h.handleInput(ENTER); // submitted
		h.handleInput(ESC); // ignored
		assert.equal(results.length, 1);
	});
});

describe("render", () => {
	test("tab bar shows answered boxes and the submit state", () => {
		const h = harnessFor(multiQs(), () => {});
		const before = h.render(80).join("\n");
		assert.ok(before.includes("□ Scope"));
		assert.ok(before.includes("□ Q2"));
		h.handleInput(ENTER);
		h.handleInput(ENTER);
		const after = h.render(80).join("\n");
		assert.ok(after.includes("■ Scope"));
		assert.ok(after.includes("Ready to submit"));
	});

	test("narrow width does not crash and wraps", () => {
		const h = harnessFor(multiQs(), () => {});
		assert.doesNotThrow(() => h.render(4));
	});
});
