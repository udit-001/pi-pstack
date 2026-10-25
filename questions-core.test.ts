import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	answerText,
	displayOptions,
	normalizeQuestions,
	OTHER_VALUE,
	resultView,
	summarizeAnswers,
	type QuestionnaireResult,
	type QuizQuestion,
} from "./questions-core.ts";

const q = (over: Partial<QuizQuestion> & { id: string }): QuizQuestion => ({
	prompt: `prompt for ${over.id}`,
	options: [
		{ value: "a", label: "Alpha" },
		{ value: "b", label: "Beta" },
	],
	...over,
});

describe("normalizeQuestions", () => {
	test("fills label and allowOther defaults", () => {
		const { questions, error } = normalizeQuestions([q({ id: "scope" }), q({ id: "priority" })]);
		assert.equal(error, undefined);
		assert.equal(questions[0]!.label, "Q1");
		assert.equal(questions[1]!.label, "Q2");
		assert.ok(questions.every((x) => x.allowOther === true));
	});

	test("respects explicit label and allowOther: false", () => {
		const { questions } = normalizeQuestions([
			q({ id: "scope", label: "Scope", allowOther: false }),
		]);
		assert.equal(questions[0]!.label, "Scope");
		assert.equal(questions[0]!.allowOther, false);
	});

	test("validates empty list, missing prompt, and empty options", () => {
		assert.equal(normalizeQuestions([]).error, "No questions provided");
		assert.ok(normalizeQuestions([q({ id: "x", prompt: "" })]).error?.includes("needs a prompt"));
		assert.ok(normalizeQuestions([q({ id: "x", options: [] })]).error?.includes("needs at least one option"));
	});
});

describe("displayOptions", () => {
	test("appends the free-text option unless allowOther is false", () => {
		const normalized = normalizeQuestions([q({ id: "a" })]).questions;
		const other = displayOptions(normalized[0]!).at(-1) as Record<string, unknown>;
		assert.equal(other.value, OTHER_VALUE);
		assert.equal(other.isOther, true);
		const off = normalizeQuestions([q({ id: "a", allowOther: false })]).questions;
		assert.equal(displayOptions(off[0]!).length, 2);
	});
});

describe("answerText", () => {
	test("single-choice and custom answers render distinctly", () => {
		const result: QuestionnaireResult = {
			questions: normalizeQuestions([q({ id: "scope", label: "Scope" })]).questions,
			answers: [
				{ id: "scope", values: ["a"], labels: ["Alpha"], wasCustom: false, indexes: [1] },
			],
			cancelled: false,
		};
		assert.equal(answerText(result), "Scope: user selected: 1. Alpha");
		result.answers[0] = {
			id: "scope",
			values: ["inline", "__other__"],
			labels: ["Inline panel", "something else"],
			wasCustom: true,
			indexes: [1, undefined],
		};
		assert.equal(
			answerText(result),
			"Scope: user selected: 1. Inline panel, user wrote: something else",
		);
	});

	test("cancel message", () => {
		assert.equal(answerText({ questions: [], answers: [], cancelled: true }),
			"User cancelled the questionnaire");
	});
});

describe("summarizeAnswers", () => {
	test("formats listed and written answers", () => {
		assert.deepEqual(
			summarizeAnswers({
				questions: [q({ id: "a", label: "Aa" }), q({ id: "b", label: "Bb" })],
				answers: [
					{ id: "a", values: ["a"], labels: ["Alpha"], wasCustom: false, indexes: [2] },
					{ id: "b", values: ["__other__"], labels: ["wrote it"], wasCustom: true, indexes: [undefined] },
				],
				cancelled: false,
			}),
			["Aa: user selected: 2. Alpha", "Bb: user wrote: wrote it"],
		);
	});
});

describe("resultView", () => {
	test("one row per question; picks numbered, writes prefixed", () => {
		const qs = normalizeQuestions([
			{
				id: "color",
				label: "Color",
				prompt: "What's your favorite color?",
				options: [{ value: "red", label: "Red" }],
			},
			{
				id: "hobbies",
				label: "Hobbies",
				prompt: "Which hobbies do you enjoy?",
				multiSelect: true,
				options: [
					{ value: "read", label: "Reading" },
					{ value: "game", label: "Gaming" },
				],
			},
		]).questions;
		const view = resultView({
			questions: qs,
			answers: [
				{ id: "color", values: ["red"], labels: ["Red"], wasCustom: false, indexes: [1] },
				{
					id: "hobbies",
					values: ["read", "game", "__other__"],
					labels: ["Reading", "Gaming", "larping"],
					wasCustom: true,
					indexes: [1, 2, undefined],
				},
			],
			cancelled: false,
		});
		assert.equal(view.header, "Questions");
		assert.equal(view.rows[0]!.prompt, "What's your favorite color?");
		assert.equal(view.rows[0]!.answer, "1. Red");
		assert.equal(view.rows[0]!.labelsJoined, "Red");
		assert.equal(view.rows[0]!.written, false);
		assert.equal(view.rows[1]!.answer, "1. Reading, 2. Gaming, wrote: larping");
		assert.equal(view.rows[1]!.labelsJoined, "Reading, Gaming, larping");
		assert.equal(view.rows[1]!.written, true);
	});
});

describe("option label/value fallback", () => {
	test("value-only option: label fills from value", () => {
		const { questions, error } = normalizeQuestions([
			{ id: "x", prompt: "p", options: [{ value: "react", description: "Fast refresh" }] },
		]);
		assert.equal(error, undefined);
		assert.equal(questions[0]!.options[0]!.label, "react");
		assert.equal(questions[0]!.options[0]!.value, "react");
	});

	test("label-only option: value fills from label", () => {
		const { questions, error } = normalizeQuestions([
			{ id: "x", prompt: "p", options: [{ label: "React" }] },
		]);
		assert.equal(error, undefined);
		assert.equal(questions[0]!.options[0]!.value, "React");
		assert.equal(questions[0]!.options[0]!.label, "React");
	});

	test("both missing: error names the question and option", () => {
		const { error } = normalizeQuestions([
			{ id: "ship", prompt: "p", options: [{ description: "d" }, { label: "ok" }] },
		]);
		assert.match(error ?? "", /Question ship option 1 needs a label or a value/);
	});
});

describe("answerText: unanswered questions", () => {
	test("skipped question renders a no-answer line", () => {
		const qs = normalizeQuestions([
			{ id: "a", label: "Aa", prompt: "p", options: [{ value: "x", label: "X" }] },
			{ id: "b", label: "Bb", prompt: "p", options: [{ value: "y", label: "Y" }] },
		]).questions;
		const text = answerText({
			questions: qs,
			answers: [{ id: "a", values: ["x"], labels: ["X"], wasCustom: false, indexes: [1] }],
			cancelled: false,
		});
		assert.deepEqual(text.split("\n"), ["Aa: user selected: 1. X", "Bb: no answer"]);
	});
});
