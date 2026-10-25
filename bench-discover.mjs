// Measurement harness for pi-pstack resources_discover. Runs the REAL
// extension handler (transpiled in-memory, SDK stubbed like pi's loader alias,
// typebox real) and times it. Baseline = full regenerate every run.
import { createRequire } from "node:module";
import ts from "/home/udit/Dev/personal/pi-web/node_modules/typescript/lib/typescript.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const typebox = await import(
  "/home/udit/.pi/agent/install/releases/1.4.0/node_modules/typebox/build/index.mjs"
);
const PKG = "/home/udit/Dev/personal/pi-pstack";
const AGENT_DIR = "/home/udit/.pi/agent";

const cache = new Map();
function loadTS(path) {
  path = resolve(path);
  if (cache.has(path)) return cache.get(path).exports;
  const src = readFileSync(path, "utf8");
  const js = ts
    .transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/import\.meta\.url/g, JSON.stringify("file://" + path));
  const mod = { exports: {} };
  cache.set(path, mod);
  const localRequire = (spec) => {
    if (spec.startsWith(".")) {
      const resolved = resolve(dirname(path), spec);
      for (const cand of [resolved, resolved + ".ts", resolved + ".js"]) {
        if (existsSync(cand) && !cand.endsWith("/")) return loadTS(cand);
      }
      throw new Error("cannot resolve " + spec);
    }
    if (spec === "typebox") return typebox;
    if (spec === "@earendil-works/pi-coding-agent") {
      return { getAgentDir: () => AGENT_DIR };
    }
    if (spec === "@earendil-works/pi-tui") {
      return { Text: class Text { constructor(t) { this.text = t; } } };
    }
    if (spec === "node:fs" || spec === "fs") return require("node:fs");
    if (spec === "node:os") return require("node:os");
    if (spec === "node:path") return require("node:path");
    if (spec === "node:url") return require("node:url");
    return require(spec);
  };
  const fn = new Function("require", "module", "exports", js);
  fn(localRequire, mod, mod.exports);
  return mod.exports;
}

const ext = loadTS(join(PKG, "index.ts"));
let discoverHandler = null;
const piMock = {
  on: (event, handler) => { if (event === "resources_discover") discoverHandler = handler; },
  registerTool: () => {},
  registerCommand: () => {},
};
ext.default(piMock);
if (!discoverHandler) throw new Error("resources_discover handler not registered");

const runs = Number(process.argv[2] || 5);
const times = [];
let lastPaths = 0;
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  const result = discoverHandler({ cwd: "/home/udit/Dev/personal" });
  const ms = performance.now() - t0;
  times.push(ms);
  lastPaths = (result?.skillPaths ?? []).length;
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(JSON.stringify({
  runs, median_ms: +median.toFixed(1), min: +times[0].toFixed(1), max: +times[times.length - 1].toFixed(1),
  all: times.map((t) => +t.toFixed(1)), skillPaths: lastPaths,
}));
