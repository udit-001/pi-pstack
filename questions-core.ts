/**
 * questions-core — pure questionnaire logic. No fs, no pi, no TUI.
 * The test surface for the questions module.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuizQuestionOption {
	value: string;
	label: string;
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
	}
	const questions = raw.map((q, i) => ({
		...q,
		label: q.label || `Q${i + 1}`,
		allowOther: q.allowOther !== false,
	}));
	return { questions };
}

/** Options for display, with the free-text option appended when allowed. */
export function displayOptions(q: QuizQuestion): Array<QuizQuestionOption & { isOther?: boolean }> {
	const opts = [...q.options];
	if (q.allowOther) opts.push({ value: OTHER_VALUE, label: "Type something.", isOther: true });
	return opts;
}

// ─── Result shaping ──────────────────────────────────────────────────────────

/** Post-TUI text for the model: one line per question, values joined. */
export function answerText(result: QuestionnaireResult): string {
	if (result.cancelled) return "User cancelled the questionnaire";
	return result.answers
		.map((a) => {
			const qLabel = result.questions.find((q) => q.id === a.id)?.label || a.id;
			const parts = a.values.map((v, i) =>
				a.indexes[i] === undefined
					? `user wrote: ${a.labels[i]}`
					: `user selected: ${a.indexes[i]}. ${a.labels[i]}`,
			);
			return `${qLabel}: ${parts.join(", ")}`;
		})
		.join("\n");
}

/** Per-question compact summary for TUI result rendering. */
export function summarizeAnswers(result: QuestionnaireResult): string[] {
	return answerText(result).split("\n");
}
