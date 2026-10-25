/**
 * questions-core — pure questionnaire logic. No fs, no pi, no TUI.
 * The test surface for the questions module.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuizQuestionOption {
	/** Branch token; defaults to `label`. */
	value?: string;
	/** Display text; defaults to `value`. */
	label?: string;
	description?: string;
	/** Your recommendation; renders a badge. The recommended option stays first. */
	recommended?: boolean;
	/** Internal: the appended free-text option. */
	isOther?: boolean;
}

export interface QuizQuestion {
	id: string;
	/** Short tab-bar label; defaults to Q<n>. */
	label?: string;
	prompt: string;
	options: QuizQuestionOption[];
	/** Offer a free-text option; default true. */
	allowOther?: boolean;
	/** Accept several picks; default false. */
	multiSelect?: boolean;
}

export interface QuizAnswer {
	id: string;
	/** Picks in selection order; single-select has exactly one. */
	values: string[];
	/** Display labels matching `values` at the same positions. */
	labels: string[];
	/** True when any pick is free text (the OTHER_VALUE entry). */
	wasCustom: boolean;
	/** 1-based list indexes matching `values` positions; written entries carry undefined. */
	indexes: (number | undefined)[];
}

export interface QuestionnaireResult {
	questions: QuizQuestion[];
	answers: QuizAnswer[];
	cancelled: boolean;
}

// ─── Normalization ───────────────────────────────────────────────────────────

export const OTHER_VALUE = "__other__";

export function normalizeQuestions(
	raw: QuizQuestion[],
): { questions: QuizQuestion[]; error?: string } {
	if (!Array.isArray(raw) || raw.length === 0) {
		return { questions: [], error: "No questions provided" };
	}
	for (const q of raw) {
		if (!q || typeof q.id !== "string" || !q.id) return { questions: [], error: "Every question needs a non-empty id" };
		if (typeof q.prompt !== "string" || !q.prompt) return { questions: [], error: `Question ${q.id} needs a prompt` };
		if (!Array.isArray(q.options) || q.options.length === 0) {
			return { questions: [], error: `Question ${q.id} needs at least one option` };
		}
		for (const [i, o] of (q.options ?? []).entries()) {
			if (!o || (typeof o.label !== "string" || !o.label) && (typeof o.value !== "string" || !o.value)) {
				return { questions: [], error: `Question ${q.id} option ${i + 1} needs a label or a value` };
			}
		}
	}
	const questions = raw.map((q, i) => ({
		...q,
		label: q.label || `Q${i + 1}`,
		allowOther: q.allowOther !== false,
		options: q.options.map((o) => ({
			...o,
			// One display string + one branch token, each filling in for the other.
			label: o.label ?? o.value!,
			value: o.value ?? o.label!,
		})),
	}));
	return { questions };
}

/** An option after normalizeQuestions: label and value are both present. */
export type ResolvedQuizOption = QuizQuestionOption & { value: string; label: string };

/** Options for display, with the free-text option appended when allowed.
 *  Call only with normalized questions — it types label/value as required. */
export function displayOptions(q: QuizQuestion): ResolvedQuizOption[] {
	const opts = [...q.options] as ResolvedQuizOption[];
	if (q.allowOther) opts.push({ value: OTHER_VALUE, label: "Type something.", isOther: true });
	return opts;
}

// ─── Result shaping ──────────────────────────────────────────────────────────

/** Post-TUI text for the model: one line per question, unanswered included. */
export function answerText(result: QuestionnaireResult): string {
	if (result.cancelled) return "User cancelled the questionnaire";
	return result.questions
		.map((q) => {
			const a = result.answers.find((answer) => answer.id === q.id);
			if (!a) return `${q.label}: no answer`;
			const parts = a.values.map((v, i) =>
				a.indexes[i] === undefined
					? `user wrote: ${a.labels[i]}`
					: `user selected: ${a.indexes[i]}. ${a.labels[i]}`,
			);
			return `${q.label}: ${parts.join(", ")}`;
		})
		.join("\n");
}

/** Per-question compact summary for TUI result rendering. */
export function summarizeAnswers(result: QuestionnaireResult): string[] {
	return answerText(result).split("\n");
}

/** Chat result view model: header + one row per question.
 *  Collapsed shows label-only lines; expanded shows prompt + numbered pairs. */
export interface QuestionResultRow {
	prompt: string;
	/** Expanded form: numbered picks + "wrote: x" in selection order. */
	answer: string;
	/** Collapsed form: display labels only — no option numbers. */
	labelsJoined: string;
	/** Any pick was free text. */
	written: boolean;
}

export function resultView(result: QuestionnaireResult): {
	header: string;
	rows: QuestionResultRow[];
} {
	const rows = result.answers.map((a) => {
		const q = result.questions.find((question) => question.id === a.id);
		const numbered = a.indexes
			.map((idx, i) => (idx === undefined ? undefined : `${idx}. ${a.labels[i]}`))
			.filter((s): s is string => s !== undefined);
		const wrote = a.labels.filter((_, i) => a.indexes[i] === undefined);
		const expandedParts = [...numbered, ...wrote.map((w) => `wrote: ${w}`)];
		return {
			prompt: q?.prompt ?? a.id,
			answer: expandedParts.join(", "),
			labelsJoined: a.labels.join(", "),
			written: wrote.length > 0,
		};
	});
	return { header: "Questions", rows };
}
