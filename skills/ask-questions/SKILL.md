---
name: ask-questions
description: "How to word and batch questionnaire questions — one concern per question, entangled answers split, batch at seams. Reached via the questionnaire tool description."
disable-model-invocation: true
---

# Ask questions

Companion to the `questionnaire` tool (its description holds when to reach for the tool; this file holds how to word the call).

## How to call it

```
questions: [
  {
    id: "surface",              // token you branch on when the answer returns
    label: "Surface",           // one-word tab-bar name, 2+ questions only
    prompt: "Where should the preview live — inline panel, modal, or new tab?",
    options: [
      { value: "inline", label: "Inline panel", recommended: true, description: "Keeps the diff visible next to your edits" },
      { value: "modal", label: "Modal" },
      { value: "tab", label: "New tab" },
    ],
  },
]
```

- Exactly one option carries `recommended: true`; it renders a badge. Keep it first, and say why in its description.
- One question per concern: merge questions with the same answer, split ones whose answers are entangled.
- Each option needs a `label` or a `value` — the other fills in. Worth writing both when they differ (`value: "react"`, `label: "React"`).
- Batching: all blocking questions ride in this one call at a natural seam. A new blocking decision mid-work earns its own call — drip questions across turns and the reader loses the whole picture; stack five questions at the seam and attention thins past four.
- `allowOther` stays on (default); omit it when the answer must be one of the listed options.
- The prompt is the ask alone; the TUI explains its own controls.

## Reading the result

One line per answer: `Scope: user selected: 1. Inline panel`, or `Scope: user wrote: ...` on free text. Proceed with the answers; do not re-ask or second-guess a selection.

## No UI available

The tool errors in `pi -p`, subagent children, and other non-interactive runs. Ask in plain text instead: one question at a time, recommendation first. If even that is impossible, decide yourself, name the decision, and mark it for the reader's review.
