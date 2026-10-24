#!/usr/bin/env node
// Re-vendor the upstream pstack subtree from cursor/plugins and pin its commit.
// Run from the repo root:  node scripts/sync-pstack.mjs  [ref]

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, ".vendor-tmp");
const OUT = join(ROOT, "pstack");
const PIN = join(ROOT, "PINNED_COMMIT");
const REF = process.argv[2] ?? "main";
const REPO = "https://github.com/cursor/plugins";

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
execSync(`git clone --filter=blob:none --no-checkout --depth 1 --branch ${REF} ${REPO} ${TMP}`, {
	stdio: "inherit",
});
execSync(
	`git -C ${TMP} sparse-checkout init --cone && git -C ${TMP} sparse-checkout set pstack && git -C ${TMP} checkout`,
	{ stdio: "inherit", shell: "bash" },
);
const commit = execSync(`git -C ${TMP} rev-parse HEAD`).toString().trim();
rmSync(OUT, { recursive: true, force: true });
cpSync(join(TMP, "pstack"), OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
writeFileSync(PIN, `${commit}\n`);
console.log(`vendored pstack at ${commit}`);
