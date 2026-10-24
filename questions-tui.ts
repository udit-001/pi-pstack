/**
 * questions-tui — the questionnaire TUI component, rebuilt on questions-core
 * types. Internal seam: buildQuestionnaire() returns plain {render,
 * invalidate, handleInput, state}; the pi adapter feeds it tui/theme and
 * reads the result through `done`.
 *
 * Modes:
 * - single-select (default): Enter picks the highlighted option and moves on.
 * - multiSelect (`multiSelect: true` on the question): Enter toggles the
 *   highlighted option; picking free text enters the inline editor; tab bar
 *   is the only way onward (Enter on Submit confirms).
 *
 * Free text: the option row itself is the input — a dim "Type something. ✎"
 * placeholder until typing, typed text replaces it in place. The editor's
 * own frame is silenced (borderColor: () => ""): zero-width border lines are
 * filtered so the first content line anchors on the option number.
 */

import { Editor, type EditorTheme, type TUI, Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	displayOptions,
	OTHER_VALUE,
	type QuizQuestion,
	type QuestionnaireResult,
} from "./questions-core.ts";

export interface TuiTheme {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}

export interface QuestionnaireHarness {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
	state(): {
		currentTab: number;
		answeredCount: number;
		total: number;
		inputMode: boolean;
	};
}

export function buildQuestionnaire(
	tui: TUI | { requestRender(): void },
	theme: TuiTheme,
	questions: QuizQuestion[],
	submit: (result: QuestionnaireResult) => void,
): QuestionnaireHarness {
	const hasTabs = questions.length > 1;
	const totalTabs = questions.length + 1; // questions + Submit
	const picked = new Set<string>(); // toggled values per question: `${qid}\u0000${value}`
	const written = new Map<string, { text: string }>(); // questionId -> free text

	let currentTab = 0;
	let optionIndex = 0;
	let inputMode = false;
	let inputQuestionId: string | null = null;
	let cachedLines: string[] | undefined;
	let submitted = false;

	const editorTheme: EditorTheme = {
		borderColor: () => "",
		selectList: {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		},
	};
	// Tests pass a minimal tui stub {requestRender}; Editor only calls requestRender
	// through the paths exercised here. Cast keeps the strict signature honest.
	const editor = new Editor(tui as TUI, editorTheme);

	function refresh() {
		cachedLines = undefined;
		tui.requestRender();
	}

	function finish(cancelled: boolean) {
		if (submitted) return;
		submitted = true;
		const answersOut = questions.flatMap((q) => {
			const a = collect(q);
			return a ? [a] : [];
		});
		submit({ questions, answers: answersOut, cancelled });
	}

	/** Current answer for a question, built from toggles + written text. */
	function collect(q: QuizQuestion):
		| {
				id: string;
				values: string[];
				labels: string[];
				wasCustom: boolean;
				indexes: (number | undefined)[];
		  }
		| undefined {
		const opts = displayOptions(q);
		const values: string[] = [];
		const labels: string[] = [];
		const indexes: (number | undefined)[] = [];
		opts.forEach((opt, i) => {
			if (opt.value === OTHER_VALUE) return; // toggling the row is not an answer
			if (picked.has(key(q, opt.value))) {
				values.push(opt.value);
				labels.push(opt.label);
				indexes.push(i + 1);
			}
		});
		const w = written.get(q.id);
		if (w) {
			values.push(OTHER_VALUE);
			labels.push(w.text);
			indexes.push(undefined);
		}
		if (values.length === 0) return undefined;
		return {
			id: q.id,
			values,
			labels,
			wasCustom: w !== undefined,
			indexes,
		};
	}

	function key(q: QuizQuestion, value: string): string {
		return `${q.id}\u0000${value}`;
	}

	function editorText(): string {
		return editor.getText();
	}

	// Focus follows the committed answer, not row 1: on re-entering a tab the
	// user is reviewing what they said, so the cursor and the check coincide.
	function seedFocus() {
		const q = questions[currentTab];
		if (!q) {
			optionIndex = 0;
			return;
		}
		const opts = displayOptions(q);
		// Prefer the first toggled row; a written answer parks on the other row.
		const firstToggled = opts.findIndex((o) => picked.has(key(q, o.value)));
		if (firstToggled >= 0) {
			optionIndex = firstToggled;
			return;
		}
		if (written.has(q.id)) {
			optionIndex = q.options.length; // the "Type something" row
			return;
		}
		optionIndex = 0;
	}

	/**
	 * Move forward after an answer commits.
	 * - multiSelect questions never advance: the mode is curate-then-submit,
	 *   and a write (free text) is a mid-curation edit, not a finish signal.
	 * - single-select with tabs: next question.
	 * - single-select without tabs (one question, no tab bar): finished.
	 */
	function advanceAfterAnswer() {
		const q = currentQuestion();
		if (q?.multiSelect) return;
		if (!hasTabs) {
			finish(false);
			return;
		}
		if (currentTab < questions.length - 1) currentTab++;
		else currentTab = questions.length; // Submit tab
		seedFocus();
		refresh();
	}

	editor.onSubmit = (value) => {
		if (!inputQuestionId) return;
		const trimmed = value.trim() || "(no response)";
		written.set(inputQuestionId, { text: trimmed });
		inputMode = false;
		inputQuestionId = null;
		editor.setText("");
		advanceAfterAnswer();
	};

	function handleInput(data: string) {
		if (submitted) return;
		if (inputMode) {
			if (matchesKey(data, Key.escape)) {
				inputMode = false;
				inputQuestionId = null;
				editor.setText("");
				refresh();
				return;
			}
			editor.handleInput(data);
			refresh();
			return;
		}

		const q = currentQuestion();
		const opts = currentOptions();
		const onSubmitTab = currentTab === questions.length;
		if (!onSubmitTab && !q) return;

		if (hasTabs) {
			if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
				currentTab = (currentTab + 1) % totalTabs;
				seedFocus();
				refresh();
				return;
			}
			if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
				currentTab = (currentTab - 1 + totalTabs) % totalTabs;
				seedFocus();
				refresh();
				return;
			}
		}

		if (onSubmitTab) {
			if (matchesKey(data, Key.enter) && allAnswered()) finish(false);
			else if (matchesKey(data, Key.escape)) finish(true);
			return;
		}
		if (!q) return; // unreachable: !onSubmitTab with no q returned above; settles the typecheck

		if (matchesKey(data, Key.up)) {
			optionIndex = Math.max(0, optionIndex - 1);
			refresh();
			return;
		}
		if (matchesKey(data, Key.down)) {
			optionIndex = Math.min(opts.length - 1, optionIndex + 1);
			refresh();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const opt = opts[optionIndex];
			if (!opt) return;
			if (opt.isOther && opt.value === OTHER_VALUE) {
				// In multiSelect, Enter on the written row finishes (the write is
				// curated and standing); with no write it opens the editor.
				if (q.multiSelect && written.has(q.id)) {
					finish(false);
					return;
				}
				inputMode = true;
				inputQuestionId = q.id;
				editor.setText("");
				refresh();
				return;
			}
			if (q.multiSelect) {
				toggle(q, opt.value);
				refresh();
				return;
			}
			[...picked]
				.filter((k) => k.startsWith(`${q.id}\u0000`))
				.forEach((k) => picked.delete(k)); // single-select: one pick per question
			picked.add(key(q, opt.value));
			advanceAfterAnswer();
			return;
		}
		if (matchesKey(data, Key.escape)) finish(true);
	}

	function toggle(q: QuizQuestion, value: string): void {
		const k = key(q, value);
		if (picked.has(k)) picked.delete(k);
		else picked.add(k);
	}

	function currentQuestion(): QuizQuestion | undefined {
		return questions[currentTab];
	}

	function currentOptions() {
		const q = currentQuestion();
		return q ? displayOptions(q) : [];
	}

	function anyAnswerPresent(): boolean {
		return questions.every((question) => {
			const toggles = [...picked].filter((k) => k.startsWith(`${question.id}\u0000`));
			return toggles.length > 0 || written.has(question.id);
		});
	}

	function allAnswered(): boolean {
		return anyAnswerPresent();
	}

	function isSubmitTab(): boolean {
		return currentTab === questions.length;
	}

	function render(width: number): string[] {
		if (cachedLines) return cachedLines;

		const lines: string[] = [];
		const renderWidth = Math.max(1, width);
		const q = currentQuestion();
		const opts = currentOptions();

		const addWrapped = (text: string) => lines.push(...wrapTextWithAnsi(text, renderWidth));
		const addWrappedWithPrefix = (prefix: string, text: string) => {
			const prefixWidth = visibleWidth(prefix);
			if (prefixWidth >= renderWidth) {
				addWrapped(prefix + text);
				return;
			}
			const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
			const continuationPrefix = " ".repeat(prefixWidth);
			wrapped.forEach((line, i) => lines.push(`${i === 0 ? prefix : continuationPrefix}${line}`));
		};

		lines.push(theme.fg("accent", "─".repeat(renderWidth)));

		if (hasTabs) {
			const tabs: string[] = ["← "];
			questions.forEach((question, i) => {
				const isActive = i === currentTab;
				const isAnswered = [...picked].some((k) => k.startsWith(`${question.id}\u0000`)) || written.has(question.id);
				const box = isAnswered ? "■" : "□";
				const color = isAnswered ? "success" : "muted";
				const text = ` ${box} ${question.label} `;
				const styled = isActive
					? theme.bg("selectedBg", theme.fg("text", text))
					: theme.fg(color, text);
				tabs.push(`${styled} `);
			});
			const canSubmit = allAnswered();
			const submitTab = currentTab === questions.length;
			const submitStyled = submitTab
				? theme.bg("selectedBg", theme.fg("text", " ✓ Submit "))
				: theme.fg(canSubmit ? "success" : "dim", " ✓ Submit ");
			tabs.push(`${submitStyled} →`);
			addWrappedWithPrefix(" ", tabs.join(""));
			lines.push("");
		}

		const renderOptions = () => {
			if (!q) return;
			const multi = q.multiSelect === true;
			opts.forEach((opt, i) => {
				const selected = i === optionIndex;
				const isOther = opt.isOther === true;
				const focusPrefix = selected ? theme.fg("accent", "> ") : "  ";
				const numberLabel = `${i + 1}. `;
				if (isOther && inputMode) {
					renderInlineInput(focusPrefix, numberLabel);
					return;
				}
				// Checkbox in multiSelect, ✓ in single: the committed-answer signal.
				let rowLabel: string;
				if (multi) {
					const checked = picked.has(key(q, opt.value)) || (isOther && written.has(q.id));
					const box = checked ? theme.fg("success", `[✓]`) : theme.fg("muted", "[ ]");
					rowLabel = `${box} ${opt.label}`;
				} else {
					const answered = [...picked].some((k) => k.startsWith(`${q.id}\u0000${opt.value}`));
					rowLabel = `${numberLabel}${opt.label}${answered ? theme.fg("success", " ✓") : ""}`;
				}
				const color = selected || (isOther && inputMode) ? "accent" : "text";
				addWrappedWithPrefix(focusPrefix, theme.fg(color, rowLabel));
				if (isOther && written.has(q.id))
					addWrappedWithPrefix("     ", theme.fg("text", `wrote: ${written.get(q.id)!.text}`));
				else if (opt.description) addWrappedWithPrefix("     ", theme.fg("muted", opt.description));
			});
		};

		// Free-text editing happens on the option row itself: while the editor is
		// empty the option label plays the placeholder, typed text replaces it in place.
		const renderInlineInput = (prefix: string, numberLabel: string) => {
			const ghost = theme.fg("dim", "Type something. ✎");
			const text = editorText();
			const indent = " ".repeat(Math.max(0, visibleWidth(prefix) + visibleWidth(numberLabel)));
			if (text.trim() === "") {
				lines.push(`${prefix}${numberLabel}${ghost}`);
				return;
			}
			const avail = Math.max(8, renderWidth - visibleWidth(prefix) - visibleWidth(numberLabel));
			// Zero-width lines are the editor's silenced border rows; every real
			// row renders the fake cursor space, so width ≥ 1. Drop them, then
			// anchor the first content line on the option number.
			editor.render(avail)
				.filter((line) => visibleWidth(line) > 0)
				.forEach((line, i) => {
					lines.push(i === 0 ? `${prefix}${numberLabel}${line}` : `${indent}${line}`);
				});
		};

		if (inputMode && q) {
			addWrappedWithPrefix(" ", theme.fg("text", q.prompt));
			lines.push("");
			renderOptions();
			lines.push("");
			addWrappedWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to go back"));
		} else if (isSubmitTab()) {
			addWrappedWithPrefix(" ", theme.fg("accent", theme.bold("Ready to submit")));
			lines.push("");
			for (const question of questions) {
				const parts: string[] = [];
				const qOpts = displayOptions(question);
				const toggledValues = qOpts
					.filter((o) => picked.has(key(question, o.value)))
					.map((o) => o.label);
				const w = written.get(question.id);
				if (toggledValues.length > 0) parts.push(toggledValues.join(", "));
				if (w) parts.push(`wrote: ${w.text}`);
				if (parts.length === 0) continue;
				addWrappedWithPrefix(
					" ",
					`${theme.fg("muted", `${question.label}: `)}${theme.fg("text", parts.join(" + "))}`,
				);
			}
			lines.push("");
			if (allAnswered()) addWrappedWithPrefix(" ", theme.fg("success", "Press Enter to submit"));
			else {
				const missing = questions
					.filter((question) => {
						const toggled = [...picked].some((k) => k.startsWith(`${question.id}\u0000`));
						return !toggled && !written.has(question.id);
					})
					.map((question) => question.label)
					.join(", ");
				addWrappedWithPrefix(" ", theme.fg("warning", `Unanswered: ${missing}`));
			}
		} else if (q) {
			addWrappedWithPrefix(" ", theme.fg("text", q.prompt));
			lines.push("");
			renderOptions();
		}

		lines.push("");
		if (!inputMode) {
			const multi = q?.multiSelect === true;
			const help = multi
				? hasTabs
					? "Tab/←→ navigate • ↑↓ select • Enter toggle • Esc cancel"
					: "↑↓ select • Enter toggle • Esc cancel"
				: hasTabs
					? "Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
					: "↑↓ navigate • Enter select • Esc cancel";
			addWrappedWithPrefix(" ", theme.fg("dim", help));
		}
		lines.push(theme.fg("accent", "─".repeat(renderWidth)));

		cachedLines = lines;
		return lines;
	}

	seedFocus();

	return {
		render,
		invalidate: () => {
			cachedLines = undefined;
		},
		handleInput,
		state: () => ({
			currentTab,
			answeredCount: questions.filter((question) => {
				const toggled = [...picked].some((k) => k.startsWith(`${question.id}\u0000`));
				return toggled || written.has(question.id);
			}).length,
			total: questions.length,
			inputMode,
		}),
	};
}
