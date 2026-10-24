# pstack questions — design

Building the pi example `questionnaire` out into pi-pstack, per the
`codebase-design` skill: deep module at a clean seam, thin pi adapter,
interface is the test surface.

## The module

**Module: `questions`** (`questions-core.ts`, `questions-tui.ts`) — structured
question-asking: schema config, answer normalization, result text TUI or no.

**Interface**:

```ts
// questions-core.ts — pure, no fs, no pi, no tui. The test surface.
export interface QuizQuestionOption { value: string; label: string; description?: string }
export interface QuizQuestion {
  id: string; label?: string; prompt: string;
  options: QuizQuestionOption[]; allowOther?: boolean;
}
export interface QuizAnswer {
  id: string; value: string; label: string;
  wasCustom: boolean; index?: number;
}
export interface QuestionnaireResult {
  questions: QuizQuestion[]; answers: QuizAnswer[]; cancelled: boolean;
}

/** Fill defaults (label Q<n>, allowOther true), validate option count. */
export function normalizeQuestions(raw: QuizQuestion[]): { questions: QuizQuestion[]; error?: string };

/** Post-TUI text for the model, e.g. "Scope: user selected: 2. Minimal". */
export function answerText(result: QuestionnaireResult): string;

/** Sort/merge helpers used by the tool result details (pure). */
export function summarizeAnswers(result: QuestionnaireResult): string[];
```

- **Depth**: two small functions + three value types on the interface; all of
  default-filling, validation, answer formatting, and details-shaping hidden.
- **The interface is the test surface**: `questions-core.test.ts` exercises
  exactly these — no pi, no TUI.

**TUI module** (`questions-tui.ts`) — the example's tab-bar questionnaire UI
(questions + submit tab; single mode = one tab), driven by the same types. It
has an internal seam: `render(width)` and `handleInput(data)` take plain
values, no TUI singletons, so the harness module can drive them.

## The adapters

- **pi adapter** (~40 lines in `index.ts`): `pi.registerTool({
  name: "questionnaire", …, execute: → questions-tui → questions-core })`.
  Owns: mode guard (`tui`-required), `ctx.ui.custom` wiring, content/details
  assembly, `renderCall`/`renderResult`. All else delegated.
- **pstack adapter** (static): `harness-data/pi.md` row for `AskQuestion`
  becomes the real thing, and the generated preamble passes the tool name into
  adapting skills.

## Shapes

```
harness-data/pi.md row:
| `AskQuestion` | `questionnaire` tool (pi-pstack). One call, 1..n questions,
| multi-choice options, free text (allowOther). In non-TUI runs (pi -p) it
| returns an error result; ask in plain text instead. |

skills/ask-questions/SKILL.md (pi-only, authored here, NOT vendored upstream):
its own skill dir in the package, exposed through the same resources_discover
list as adapted pstack skills.
```

## Rejected framings

- Vendor the example file and register it directly — it is a monolith doing
  schema + state + render + format, untestable past its one seam (pi API).
- A second TUI implementation for the "single question" case — the tab UI covers
  1..n questions with the same key semantics (tab locked with <2 questions).
- Making the skill part of the vendored pstack sources: it is deliberately pi
  vocab; it would be re-adapted as if it upstream, breaking the pin invariant.
