/**
 * pi-pstack harness core — turn a pstack source tree into a pi harness tree.
 *
 * Deep module: two functions, in-memory only (no fs, no pi imports).
 * Callers hand it a source tree (relPath -> file bytes) and a config; it hands
 * back a fully adapted tree and a problem list. All behavior lives here.
 */

import { posix } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileEntry {
  bytes: Buffer;
  executable: boolean;
}

/** relPath (posix separators) -> entry. Rooted at a pstack tree or harness tree. */
export type SourceTree = Map<string, FileEntry>;

export interface HarnessConfig {
  /** Adapter doc name, e.g. "pi". Lands at docs/harness/<name>.md in the generated tree. */
  adapterDocName: string;
  /** Hand-authored pi harness adapter text (term -> pi row table). */
  adapterDocText: string;
  /** Text for the generated PI-HARNESS.md note at the tree root. */
  generatedReadmeText: string;
  /**
   * Injection line under each relevant skill's H1. The literal `adapter` is
   * replaced with the adapter doc name.
   */
  preambleTemplate: string;
  /** Base for relinking markdown to GitHub, e.g. "https://github.com/cursor/plugins". */
  githubBase: string;
}

export interface SkillClass {
  /** Canonical Cursor terms this skill's markdown mentions. */
  usesCursorNames: Set<string>;
  /** SKILL.md has an H1, so the preamble can be injected under it. */
  wrap: boolean;
}

// ─── Cursor terms the adapter doc must have a row for ────────────────────────

/** Extra canonical key: routing to another pstack skill by bare name. */
export const ROUTE_KEY = "Run another pstack skill";

export interface Term {
  key: string;
  re: RegExp;
}

/**
 * The canonical Cursor-name vocabulary, shared by classification and
 * adapter coverage checks. Mirrors upstream's terms list.
 */
export const CURSOR_TERMS: Term[] = [
  { key: "`Task`", re: /`Task`|\bTask (tool|subagent|call)/ },
  { key: "`AskQuestion`", re: /AskQuestion/ },
  { key: "todolist", re: /\btodo ?list\b/i },
  { key: "generalPurpose", re: /generalPurpose/ },
  { key: "poteto-agent", re: /poteto-agent/ },
  { key: "comment-sicko", re: /comment-sicko/ },
  { key: "`readonly: true`", re: /readonly: (true|false)|readonly\/Ask/ },
  { key: '`environment: "cloud"`', re: /environment: "(cloud|local)"/ },
  { key: "cloud_base_branch", re: /cloud_base_branch/ },
  { key: "`run_in_background: true`", re: /run_in_background/ },
  { key: "`resume`", re: /`resume`/ },
  { key: "`file_attachments`", re: /file_attachments/ },
  { key: "claude-", re: /\bclaude-[a-z]+-\d/ },
  { key: "grok-", re: /\bgrok-\d/ },
  { key: "gpt-", re: /\bgpt-\d/ },
  { key: "inherit-parent", re: /inherit-parent/ },
  { key: "pstack-models.mdc", re: /pstack-models\.mdc/ },
  { key: ".cursor/skills/", re: /\.cursor\/skills/ },
  { key: "~/.cursor/plugins/", re: /\.cursor\/plugins|\.cursor-plugin/ },
  { key: ".cursor/rules/", re: /\.cursor\/rules|always-applied rule/ },
  { key: "agent-transcripts", re: /agent-transcripts|\.cursor\/projects/ },
  {
    key: "Cursor-only features",
    re: /Bugbot|Cursor [Aa]utomation|cursor\.(sh|com)\/automations|[Cc]loud [Aa]gent|built-in PR tool/,
  },
];

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Source paths the harness copies into the pi tree. */
const INCLUDES: RegExp[] = [/^skills\//, /^agents\//, /^docs\//, /^README\.md$/, /^LICENSE$/];

// ─── Classification ──────────────────────────────────────────────────────────

function skillDirs(source: SourceTree): string[] {
  const dirs = new Set<string>();
  for (const key of source.keys()) {
    const m = key.match(/^skills\/([^/]+)\//);
    if (m) dirs.add(m[1]);
  }
  return [...dirs].filter((d) => source.has(`skills/${d}/SKILL.md`)).sort();
}

/** For each pstack skill, which Cursor names its markdown mentions, and whether it wraps. */
export function classifySkills(source: SourceTree): Map<string, SkillClass> {
  const skills = skillDirs(source);
  const classes = new Map<string, SkillClass>();
  for (const skill of skills) {
    const others = skills.filter((n) => n !== skill).join("|");
    const route = new RegExp(
      `the \\*\\*(?<bold>${others})\\*\\* skill|\`/(?<command>${others})\``,
      "g",
    );
    const linksToSkill = (line: string, name: string) => line.includes(`(../${name}/`);
    const namesBareSkill = (line: string) =>
      [...line.matchAll(route)].some(
        ({ groups }) => groups && !linksToSkill(line, groups.bold ?? groups.command ?? ""),
      );
    const usesCursorNames = new Set<string>();
    for (const [rel, entry] of source) {
      if (!rel.startsWith(`skills/${skill}/`) || !rel.endsWith(".md")) continue;
      const text = entry.bytes.toString("utf8");
      for (const term of CURSOR_TERMS) if (term.re.test(text)) usesCursorNames.add(term.key);
      if (text.split("\n").some(namesBareSkill)) usesCursorNames.add(ROUTE_KEY);
    }
    const text = source.get(`skills/${skill}/SKILL.md`)!.bytes.toString("utf8");
    const wrap = usesCursorNames.size > 0 && /^# /m.test(text);
    classes.set(skill, { usesCursorNames, wrap });
  }
  return classes;
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/**
 * Enforce the harness invariants against a source tree and the adapter doc.
 * Returns human-readable problem strings; empty means healthy.
 */
export function check(source: SourceTree, adapterDocText: string): string[] {
  const problems: string[] = [];
  const using = new Map<string, string[]>();
  for (const [skill, { usesCursorNames, wrap }] of classifySkills(source)) {
    if (usesCursorNames.size > 0 && !wrap)
      problems.push(`skills/${skill}/SKILL.md uses Cursor names but has no H1`);
    for (const key of usesCursorNames)
      using.set(key, [...(using.get(key) ?? []), skill]);
    const frontmatter =
      source.get(`skills/${skill}/SKILL.md`)!.bytes.toString("utf8").match(/^---\n([\s\S]*?)\n---/)
        ?.[1] ?? "";
    const name = frontmatter.match(/^name:(.*)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
    if (!name || name !== skill)
      problems.push(
        `skills/${skill}/SKILL.md has name ${JSON.stringify(name)}, not its folder name ${skill}`,
      );
    if (!SKILL_NAME.test(skill) || skill.length > 64)
      problems.push(
        `skills/${skill} is not lowercase words joined by hyphens, at most 64 characters`,
      );
  }
  for (const [key, skills] of using) {
    if (!adapterDocText.includes(key))
      problems.push(`pi harness adapter doc has no row for ${key}, used by ${skills.join(", ")}`);
  }
  return problems;
}

// ─── Adaptation ──────────────────────────────────────────────────────────────

/** The pstack-relative path that a relative link in `from` points at, if it exists. */
function resolveLink(source: SourceTree, from: string, href: string): string | undefined {
  const target = href.replace(/[#?].*/, "");
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return undefined;
  const parts = [...posix.dirname(from).split("/"), ...target.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") { out.pop(); continue; }
    out.push(part);
  }
  const path = out.join("/");
  return source.has(path) ? path : undefined;
}

function inTree(files: SourceTree, path: string): boolean {
  return files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`));
}

/** Preserve `href`'s fragment after a relink. */
function withFragment(newBase: string, href: string): string {
  const frag = href.match(/[#?].*/)?.[0] ?? "";
  return `](${newBase}${frag})`;
}

const LINK = /\]\(([^)\s]+)\)/g;

/**
 * Turn a pstack source tree into a pi harness tree:
 * copy included paths, inject the adapter preamble into relevant SKILL.md
 * headers, emit the pi adapter doc, and relink markdown that points into
 * paths the tree omits.
 */
export function adapt(source: SourceTree, cfg: HarnessConfig): SourceTree {  const classes = classifySkills(source);
  const adapterPath = `docs/harness/${cfg.adapterDocName}.md`;

  // Copy the included slice.
  const files: SourceTree = new Map();
  for (const key of [...source.keys()].sort()) {
    if (!INCLUDES.some((re) => re.test(key))) continue;
    files.set(key, source.get(key)!);
  }

  // Emit the pi adapter doc and the generated note.
  files.set(adapterPath, { bytes: Buffer.from(cfg.adapterDocText), executable: false });
  files.set("PI-HARNESS.md", { bytes: Buffer.from(cfg.generatedReadmeText), executable: false });

  // Inject the preamble under each relevant SKILL.md's H1. The preamble
  // references the in-tree adapter doc, never links, so order against
  // relinking does not matter; do it before for stable output.
  for (const [skill, { wrap }] of classes) {
    if (!wrap) continue;
    const path = `skills/${skill}/SKILL.md`;
    const entry = files.get(path)!;
    const line = cfg.preambleTemplate.replaceAll("{adapter}", cfg.adapterDocName);
    files.set(
      path,
      {
        ...entry,
        bytes: Buffer.from(entry.bytes.toString("utf8").replace(/^(# .*)\n+/m, `$1\n\n${line}\n\n`)),
      },
    );
  }

  // Relink markdown pointing to paths the tree omits.
  for (const [path, entry] of files) {
    if (!path.endsWith(".md")) continue;
    const text = entry.bytes.toString("utf8").replace(LINK, (link, href) => {
      const target = resolveLink(source, path, href);
      if (!target || target.split("/")[0] === ".." || inTree(files, target)) return link;
      const kind = [...source.keys()].some((k) => k.startsWith(`${target}/`))
        ? "tree"
        : "blob";
      return withFragment(`${cfg.githubBase}/${kind}/main/pstack/${target}`, href);
    });
    if (text !== entry.bytes.toString("utf8"))
      files.set(path, { ...entry, bytes: Buffer.from(text) });
  }

  return files;
}
