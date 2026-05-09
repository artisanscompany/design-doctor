import type { Diagnostic, ProjectInfo, RunnerResult } from "../types.js";
import { bar, face, grade as toGrade } from "../score.js";
import { fetchRule } from "../registry.js";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
};

const MAX_CATEGORIES_NON_VERBOSE = 5;
const MAX_RULES_PER_CATEGORY_NON_VERBOSE = 3;
const MAX_FILES_PER_RULE_NON_VERBOSE = 3;

export interface TtyOptions {
  noColor: boolean;
  verbose: boolean;
  full: boolean;
}

export interface TtyContext {
  project: ProjectInfo;
  result: RunnerResult & { ranAnalyzers?: string[] };
  score: number;
  visionScore?: number;
  options: TtyOptions;
}

export function renderTty(ctx: TtyContext, io: NodeJS.WriteStream = process.stdout) {
  const { project, result, score, options } = ctx;
  const c = options.noColor ? noColors() : COLORS;
  const out = (s: string) => io.write(s + "\n");

  // Detection phase
  out(`${c.bold}design-doctor${c.reset} ${c.dim}scanning${c.reset} ${shorten(project.frontendRoot)}`);
  out(`  ${c.green}✔${c.reset} stack: ${describeStack(project)}`);
  out(`  ${c.green}✔${c.reset} styling: ${project.styling}${project.hasTailwindConfig ? " (config detected)" : ""}`);
  out(`  ${c.green}✔${c.reset} bundler: ${project.bundler}`);
  if (project.hasI18nLib) out(`  ${c.green}✔${c.reset} i18n: ${project.i18nLib}`);
  if (project.hasStorybook) out(`  ${c.green}✔${c.reset} storybook: yes`);
  if (project.hasRails) out(`  ${c.green}✔${c.reset} companion: Rails (run rails-doctor for the Ruby side)`);
  out("");

  // Analyzer phase
  for (const a of result.ranAnalyzers ?? result.analyzers ?? []) {
    out(`  ${c.green}✔${c.reset} ${c.dim}analyzer:${c.reset} ${a}`);
  }
  out("");

  // Diagnostics
  if (result.diagnostics.length === 0) {
    out(`${c.green}No issues found.${c.reset}`);
  } else {
    renderDiagnostics(result.diagnostics, options, c, out);
  }

  // Score block
  const grade = toGrade(score);
  const gradeColor = grade === "Great" ? c.green : grade === "Needs work" ? c.yellow : c.red;
  const [eyes, mouth] = face(score);
  out("");
  out(`  ${c.dim}─────────────────────────────────────────────────${c.reset}`);
  out(`        ┌─────────┐`);
  out(`        │  ${eyes}  │   Score: ${gradeColor}${c.bold}${score}/100${c.reset}  ${gradeColor}${grade}${c.reset}`);
  out(`        │  ${mouth}  │   ${c.dim}static lint, no vision pass${c.reset}`);
  out(`        └─────────┘`);
  out(`  ${gradeColor}${bar(score)}${c.reset}`);
  out(`  ${c.dim}─────────────────────────────────────────────────${c.reset}`);
  out("");

  // Footer
  const counts = countSeverities(result.diagnostics);
  const affectedFiles = new Set(result.diagnostics.map((d) => d.file).filter(Boolean));
  out(`${c.dim}${counts.error} error · ${counts.warning} warning · ${counts.info} info — across ${affectedFiles.size} files in ${result.elapsedMs}ms${c.reset}`);
}

function describeStack(p: ProjectInfo): string {
  const parts: string[] = [];
  parts.push(p.frontendStack);
  if (p.reactVersion) parts.push(`react ${p.reactVersion}`);
  if (p.inertiaVersion) parts.push(`inertia ${p.inertiaVersion}`);
  if (p.tanstackRouterVersion) parts.push(`tanstack-router ${p.tanstackRouterVersion}`);
  if (p.tailwindVersion) parts.push(`tailwind ${p.tailwindVersion}`);
  return parts.join(", ");
}

function renderDiagnostics(
  diags: Diagnostic[],
  options: TtyOptions,
  c: typeof COLORS,
  out: (s: string) => void,
) {
  const byCategory = groupBy(diags, (d) => d.category);
  const categories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  const limitCats = options.full || options.verbose ? categories.length : Math.min(MAX_CATEGORIES_NON_VERBOSE, categories.length);

  for (let i = 0; i < limitCats; i++) {
    const [cat, ds] = categories[i];
    out(`${c.bold}${cat}${c.reset} ${c.dim}(${ds.length})${c.reset}`);
    const byRule = groupBy(ds, (d) => d.ruleId);
    const ruleEntries = [...byRule.entries()].sort((a, b) => b[1].length - a[1].length);
    const limitRules = options.full || options.verbose ? ruleEntries.length : Math.min(MAX_RULES_PER_CATEGORY_NON_VERBOSE, ruleEntries.length);
    for (let j = 0; j < limitRules; j++) {
      const [ruleId, hits] = ruleEntries[j];
      const sev = hits[0].severity;
      const sym = sev === "error" ? `${c.red}✗${c.reset}` : sev === "warning" ? `${c.yellow}⚠${c.reset}` : `${c.cyan}ℹ${c.reset}`;
      const rule = safeRule(ruleId);
      out(`  ${sym} ${c.bold}${rule.title}${c.reset} ${c.dim}×${hits.length}  ${ruleId}${c.reset}`);
      const message = hits[0].message;
      if (message) out(`     ${message}`);
      if (rule.fix) out(`     ${c.dim}fix:${c.reset} ${rule.fix}`);
      const fileHits = hits.filter((h) => h.file).slice(0, options.verbose || options.full ? 25 : MAX_FILES_PER_RULE_NON_VERBOSE);
      for (const h of fileHits) {
        out(`     ${c.dim}↳${c.reset} ${h.file}${h.line ? `:${h.line}` : ""}`);
      }
      const more = hits.length - fileHits.length;
      if (more > 0) out(`     ${c.dim}↳ … (+${more} more)${c.reset}`);
    }
    if (limitRules < ruleEntries.length) {
      out(`  ${c.dim}… (+${ruleEntries.length - limitRules} more rules — pass --verbose)${c.reset}`);
    }
    out("");
  }
  if (limitCats < categories.length) {
    out(`${c.dim}… (+${categories.length - limitCats} more categories — pass --verbose)${c.reset}`);
    out("");
  }
}

function safeRule(ruleId: string) {
  try { return fetchRule(ruleId); } catch { return { id: ruleId, title: ruleId, fix: undefined } as { id: string; title: string; fix?: string }; }
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item); else out.set(k, [item]);
  }
  return out;
}

function countSeverities(d: Diagnostic[]): { error: number; warning: number; info: number } {
  const out = { error: 0, warning: 0, info: 0 };
  for (const x of d) out[x.severity]++;
  return out;
}

function shorten(p: string): string {
  const home = process.env.HOME;
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function noColors() {
  const blank: Record<keyof typeof COLORS, string> = {
    reset: "", bold: "", dim: "", red: "", yellow: "", green: "", cyan: "", blue: "", gray: "", magenta: "",
  };
  return blank;
}
