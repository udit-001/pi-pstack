/**
 * pi-pstack — thin adapter between pi's extension API and the harness module.
 *
 * All behavior lives in harness-core.ts. This file reads the vendored pstack
 * sources, hands them to the harness, writes the generated tree, and exposes
 * it to pi through resources_discover (pi's dynamic resource loading).
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adapt, check, type SourceTree, type FileEntry, type HarnessConfig } from "./harness-core.ts";

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

// ─── Source reading (the module's only fs) ───────────────────────────────────

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

