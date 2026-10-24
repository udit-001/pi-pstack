import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	adapt,
	check,
	classifySkills,
	type FileEntry,
	type HarnessConfig,
	type SourceTree,
} from "./harness-core.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function file(bytes: string, executable = false): FileEntry {
	return { bytes: Buffer.from(bytes), executable };
}

const FM = (name: string) => `---
name: ${name}
description: test
---\n`;

function cfg(): HarnessConfig {
	return {
		adapterDocName: "pi",
		adapterDocText: readFileSync(join(import.meta.dir, "harness-data", "pi.md"), "utf8"),
		generatedReadmeText: "generated note",
		preambleTemplate:
			"In pi, read [the pi harness adapter](../../docs/harness/pi.md) once per session before you follow this skill. It maps the Cursor names in pstack skills to pi.",
		githubBase: "https://github.com/cursor/plugins",
	};
}

// skills/a is clean; skills/b uses Cursor names and routes to the **a** skill.
function fixtureTree(): SourceTree {
	return new Map([
		["skills/a/SKILL.md", file(`${FM("a")}# A skill\n\nJust read files.\n`)],
		["skills/b/SKILL.md", file(`${FM("b")}# B skill\n\nUse \`Task\` and the **a** skill\n`)],
		[
			"skills/b/scripts/run.sh",
			file("#!/bin/sh\necho hi\n", true),
		],
		["agents/poteto-agent.md", file("---\nname: poteto-agent\n---\nbody\n")],
		["docs/guide/README.md", file("# Guide\n")],
		["docs/harness/claude-code.md", file("# pstack in Claude Code\n")],
		["README.md", file("# pstack\n")],
		["LICENSE", file("MIT\n")],
		["automations/benny/README.md", file("# benny\n")],
		["assets/logo.png", file("png", false)],
		[".cursor-plugin/plugin.json", file("{}\n")],
		["plugin.json", file("{}\n")],
	]);
}

// ─── check ───────────────────────────────────────────────────────────────────

describe("check", () => {
	test("fixture tree with full adapter doc passes", () => {
		expect(check(fixtureTree(), cfg().adapterDocText)).toEqual([]);
	});

	test("missing adapter row is named with the skills that use it", () => {
		const problems = check(fixtureTree(), "# pstack in pi\n\nno rows\n");
		expect(problems.length).toBe(2);
		const row = problems.find((p) => p.includes("`Task`"));
		expect(row).toContain("used by b");
	});

	test("name mismatch and bare-name routing are reported", () => {
		const tree = new Map([
			[
				"skills/aa/SKILL.md",
				file(`${FM("zz")}# AA\n\nRead the **poteto-mode** skill\n`),
			],
			["skills/poteto-mode/SKILL.md", file(`${FM("poteto-mode")}# PM\n`)],
		]);
		const problems = check(tree, cfg().adapterDocText);
		expect(problems.some((p) => p.includes("has name \"zz\", not its folder name aa"))).toBe(true);
		expect(problems.some((p) => p.includes("Run another pstack skill"))).toBe(false);
	});

	test("upper-case non-conforming skill names are rejected", () => {
		const tree = new Map([["skills/Bad/SKILL.md", file(`${FM("Bad")}# Bad\n`)]]);
		expect(check(tree, cfg().adapterDocText).length).toBeGreaterThan(0);
	});

	test("skill using Cursor names without an H1 is reported", () => {
		const tree = new Map([["skills/bad/SKILL.md", file(`${FM("bad")}\nUse \`Task\` here\n`)]]);
		const problems = check(tree, cfg().adapterDocText);
		expect(problems.some((p) => p.includes("uses Cursor names but has no H1"))).toBe(true);
	});
});

// ─── classifySkills ──────────────────────────────────────────────────────────

describe("classifySkills", () => {
	test("bare-name routing is detected; linked routing is not", () => {
		const tree = new Map([
			["skills/aa/SKILL.md", file(`${FM("aa")}# AA\nRun the **bb** skill now\n`)],
			["skills/bb/SKILL.md", file(`${FM("bb")}# BB\nSee (../aa/) for the other one\n`)],
		]);
		const classes = classifySkills(tree);
		expect(classes.get("aa")!.usesCursorNames.has("Run another pstack skill")).toBe(true);
		expect(classes.get("bb")!.usesCursorNames.has("Run another pstack skill")).toBe(false);
	});

	test("wrap requires both Cursor names and an H1", () => {
		const tree = new Map([
			["skills/aa/SKILL.md", file(`${FM("aa")}Use \`Task\` no heading\n`)],
			["skills/bb/SKILL.md", file(`${FM("bb")}# BB\nNothing here\n`)],
		]);
		const classes = classifySkills(tree);
		expect(classes.get("aa")!.wrap).toBe(false);
		expect(classes.get("bb")!.wrap).toBe(false);
	});
});

// ─── adapt ───────────────────────────────────────────────────────────────────

describe("adapt", () => {
	test("copies included paths, drops upstream-only files", () => {
		const out = adapt(fixtureTree(), cfg());
		for (const [path] of out) {
			expect(
				/^(skills|agents|docs)\//.test(path) ||
					path === "README.md" ||
					path === "LICENSE" ||
					path === "PI-HARNESS.md"
					? null
					: `included: ${path}`,
			).toBeNull();
		}
		expect(out.has("automations/benny/README.md")).toBe(false);
		expect(out.has("assets/logo.png")).toBe(false);
		expect(out.has(".cursor-plugin/plugin.json")).toBe(false);
		expect(out.has("plugin.json")).toBe(false);
	});

	test("executable bit is preserved", () => {
		const out = adapt(fixtureTree(), cfg());
		expect(out.get("skills/b/scripts/run.sh")!.executable).toBe(true);
		expect(out.get("skills/b/SKILL.md")!.executable).toBe(false);
	});

	test("injects the preamble only into wrapped skills", () => {
		const out = adapt(fixtureTree(), cfg());
		const b = out.get("skills/b/SKILL.md")!.bytes.toString("utf8");
		const a = out.get("skills/a/SKILL.md")!.bytes.toString("utf8");
		expect(b).toContain("In pi, read [the pi harness adapter](../../docs/harness/pi.md)");
		expect(b).toContain("# B skill\n\nIn pi, read");
		expect(a).not.toContain("In pi");
	});

	test("emits the adapter doc from config", () => {
		const out = adapt(fixtureTree(), cfg());
		expect(out.get("docs/harness/pi.md")!.bytes.toString("utf8")).toBe(cfg().adapterDocText);
	});

	test("relinks markdown that points into omitted paths", () => {
		const tree = new Map([
			[
				"skills/aa/SKILL.md",
				file(
					`${FM("aa")}# AA\nSee [benny](../../automations/benny/README.md) and [guide](../../docs/guide/README.md)\n`,
				),
			],
			["docs/guide/README.md", file("# Guide\n")],
			["automations/benny/README.md", file("# benny\n")],
		]);
		const out = adapt(tree, cfg());
		const text = out.get("skills/aa/SKILL.md")!.bytes.toString("utf8");
		expect(text).toContain(
			"https://github.com/cursor/plugins/blob/main/pstack/automations/benny/README.md",
		);
		expect(text).not.toContain("../automations");
		expect(text).toContain("https://github.com/cursor/plugins");
		// Fragment after a relink is preserved.
		const fragTree = new Map([
			[
				"skills/aa/SKILL.md",
				file(`${FM("aa")}# AA\n[frag](../../automations/benny/README.md#setup) and [guide](../../docs/guide/README.md)\n`),
			],
			["docs/guide/README.md", file("# Guide\n")],
			["automations/benny/README.md", file("# benny\n")],
		]);
		expect(adapt(fragTree, cfg()).get("skills/aa/SKILL.md")!.bytes.toString("utf8")).toContain(
			".md#setup",
		);
	});
});

// ─── The vendored upstream tree ──────────────────────────────────────────────

describe("vendored pstack sources", () => {
	const ROOT = join(import.meta.dir, "pstack");
	const VENDOR_MISSING = `run scripts/sync-pstack.mjs (vendored tree missing at ${ROOT})`;

	test("check() passes against the hand-authored pi adapter doc", () => {
		if (!existsSync(join(ROOT, "skills"))) throw new Error(VENDOR_MISSING);
		const tree: SourceTree = new Map();
		const walk = (dir: string, rel: string): void => {
			const { readdirSync, statSync } = require("node:fs");
			for (const name of readdirSync(dir).sort()) {
				if (name === ".DS_Store" || name === "node_modules" || name === ".git") continue;
				const abs = join(dir, name);
				const path = rel ? `${rel}/${name}` : name;
				if (statSync(abs).isDirectory()) walk(abs, path);
				else {
					const st = statSync(abs);
					tree.set(path, { bytes: readFileSync(abs), executable: (st.mode & 0o111) !== 0 });
				}
			}
		};
		walk(ROOT, "");
		const problems = check(tree, cfg().adapterDocText);
		if (problems.length > 0) console.log(problems.join("\n"));
		expect(problems).toEqual([]);
	});
});
