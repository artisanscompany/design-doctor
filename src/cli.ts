import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectProject, isFrontendApp } from "./project.js";
import { loadConfig } from "./config.js";
import { compute, grade as toGrade } from "./score.js";
import { Runner, type Analyzer } from "./runner.js";
import { renderTty } from "./reporters/tty.js";
import { renderJson } from "./reporters/json.js";
import { renderMarkdown } from "./reporters/markdown.js";
import { allRules, fetchRule } from "./registry.js";
import { gitDiffFiles } from "./diff.js";
import { install } from "./installer.js";
import { VERSION } from "./version.js";
import "./rules.js";
import { designTokensAnalyzer } from "./analyzers/design-tokens.js";
import { microcopyAnalyzer } from "./analyzers/microcopy.js";
import { a11yAnalyzer } from "./analyzers/a11y.js";
import { formsAnalyzer } from "./analyzers/forms.js";
import { uiStatesAnalyzer } from "./analyzers/ui-states.js";
import { inertiaAnalyzer } from "./analyzers/inertia.js";
import { tanstackAnalyzer } from "./analyzers/tanstack.js";
import { stackAnalyzer } from "./analyzers/stack.js";
import { runVisionPass } from "./vision/orchestrator.js";
import { finalize, writeFinalReport } from "./vision/finalize.js";
import { SUB_DIMENSIONS } from "./vision/rubric.js";

const USAGE = `
Usage: design-doctor <command> [options]

Commands:
  scan [path]         Scan a React project (default if first arg is a path)
  finalize [path]     Fold the agent's vision.json into the score (after scan --vision)
  install             Drop design-doctor into detected agent skill dirs
  explain <rule-id>   Show docs for a rule
  rules               List all rules
  version             Print version
  help                Show this message

Common scan flags:
  --verbose                Show all rules + full file lists
  --full                   No truncation (all categories)
  --score                  Print only the numeric score (for CI)
  --json | --markdown      Machine-/PR-friendly output
  --strict                 Promote warnings to errors
  --diff [BASE]            Filter to files changed vs BASE (default: main)
  --fail-on error|warning  Exit non-zero policy
  --min-score N            Exit non-zero if score < N
  --no-color               Disable ANSI

Vision pass (opt-in, requires Playwright + a running dev server):
  --vision                 Capture screenshots and emit a rubric for the agent to grade
  --url URL                Base URL of running app (default http://localhost:3000)
  --routes-cap N           Max routes to capture (default 10)
`;

const ANALYZERS: Analyzer[] = [
  designTokensAnalyzer,
  microcopyAnalyzer,
  a11yAnalyzer,
  formsAnalyzer,
  uiStatesAnalyzer,
  inertiaAnalyzer,
  tanstackAnalyzer,
  stackAnalyzer,
];

interface ScanOpts {
  path: string;
  json: boolean;
  markdown: boolean;
  strict: boolean;
  verbose: boolean;
  full: boolean;
  scoreOnly: boolean;
  noColor: boolean;
  minScore: number | null;
  failOn: "error" | "warning" | "none";
  diff: string | null;
  vision: boolean;
  url: string | null;
  routesCap: number | null;
}

export function start(argv: string[]): void {
  const args = argv.slice();
  if (args.length === 0) { process.stdout.write(USAGE); return; }
  const head = args[0];

  if (head === "version" || head === "-v" || head === "--version") {
    console.log(`design-doctor ${VERSION}`);
    return;
  }
  if (head === "help" || head === "-h" || head === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  if (head === "rules") return runRules();
  if (head === "explain") return runExplain(args.slice(1));
  if (head === "install") return runInstall(args.slice(1));
  if (head === "finalize") return runFinalize(args.slice(1));

  if (head === "scan") return runScan(args.slice(1));
  // Bare path → treat as scan
  return runScan(args);
}

function runRules() {
  for (const r of allRules().sort((a, b) => `${a.category}/${a.id}`.localeCompare(`${b.category}/${b.id}`))) {
    console.log(`  ${r.defaultSeverity.padEnd(8)} ${r.category.padEnd(10)} ${r.id}`);
  }
}

function runExplain(args: string[]) {
  const ruleId = args[0];
  if (!ruleId) {
    console.error("Usage: design-doctor explain <rule-id>");
    process.exit(2);
  }
  try {
    const r = fetchRule(ruleId);
    console.log(`${r.id}  (${r.category}, default: ${r.defaultSeverity})`);
    console.log(r.title);
    console.log("");
    if (r.fix) console.log(`Fix: ${r.fix}`);
    if (r.description) console.log(r.description);
    if (r.docUrl) console.log(r.docUrl);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}

function runInstall(args: string[]) {
  const dryRun = args.includes("--dry-run");
  const results = install({ dryRun });
  if (results.length === 0) {
    console.log("No agent skill directories detected. Make sure your editor (Claude Code, Codex, Cursor, …) has been launched at least once.");
    return;
  }
  for (const r of results) {
    console.log(`${r.copied ? "✓" : " "} ${r.dest}${dryRun ? " (dry-run)" : ""}`);
  }
}

function runFinalize(args: string[]) {
  const path = args.find((a) => !a.startsWith("--")) ?? ".";
  const project = detectProject(path);
  const outDir = join(project.root, ".design-doctor");
  try {
    const result = finalize({ outDir });
    writeFinalReport(outDir, result);
    renderFinalize(result);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}

function runScan(args: string[]) {
  const opts = parseScanArgs(args);
  const project = detectProject(opts.path);

  if (!isFrontendApp(project)) {
    console.error(`design-doctor: no React frontend detected at ${project.frontendRoot}`);
    process.exit(2);
  }

  const config = loadConfig(project.root);
  const diffFiles = opts.diff ? gitDiffFiles(project.root, opts.diff) : null;

  const runner = new Runner(
    project,
    config,
    { verbose: opts.verbose, diffFiles },
    ANALYZERS,
  );

  runner.run().then(async (result) => {
    if (opts.strict) {
      for (const d of result.diagnostics) if (d.severity === "warning") d.severity = "error";
    }
    const score = compute(result.diagnostics);

    if (opts.scoreOnly) {
      process.stdout.write(`${score}\n`);
      return enforcePolicy(score, opts, result.diagnostics);
    }

    if (opts.json) {
      process.stdout.write(renderJson({ project, result, score }) + "\n");
    } else if (opts.markdown) {
      process.stdout.write(renderMarkdown({ project, result, score }) + "\n");
    } else {
      renderTty({
        project,
        result,
        score,
        options: { noColor: opts.noColor, verbose: opts.verbose, full: opts.full },
      });
    }

    // Always cache the result for any future `finalize` step.
    try {
      const dir = join(project.root, ".design-doctor");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "result.json"), renderJson({ project, result, score }));
    } catch {
      // best-effort
    }

    if (opts.vision) {
      try {
        const v = await runVisionPass(project, config, score, {
          baseUrl: opts.url ?? config.url,
          routesCap: opts.routesCap ?? 10,
        });
        printVisionFollowup(v);
      } catch (e) {
        console.error("");
        console.error(`vision pass failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(2);
      }
    }

    enforcePolicy(score, opts, result.diagnostics);
  });
}

function printVisionFollowup(v: { rubricPath: string; templatePath: string; capturedRoutes: number; failedRoutes: number; baseUrl: string }) {
  console.log("");
  console.log(`vision pass: captured ${v.capturedRoutes} screenshot pairs from ${v.baseUrl}${v.failedRoutes ? ` (${v.failedRoutes} failed)` : ""}`);
  console.log(`  • rubric: ${v.rubricPath}`);
  console.log(`  • template: ${v.templatePath}`);
  console.log("");
  console.log(`Next:`);
  console.log(`  1. Read the rubric and the screenshots.`);
  console.log(`  2. Score each route 0–10 per sub-dimension. Save to .design-doctor/vision.json (template provided).`);
  console.log(`  3. Run: npx -y design-doctor finalize`);
}

function renderFinalize(r: ReturnType<typeof finalize>) {
  console.log("");
  console.log(`design-doctor — final score`);
  console.log(`  static: ${r.staticScore} (capped at 70 for vision-aware scoring)`);
  console.log(`  vision mean: ${r.visionMean}/10  (contributes ${r.visionContribution} of 30)`);
  console.log(`  final: ${r.finalScore}/100`);
  console.log("");
  console.log(`weakest dimensions:`);
  for (const w of r.weakestDimensions) {
    const label = SUB_DIMENSIONS.find((d) => d.id === w.id)?.label ?? w.id;
    console.log(`  ${w.mean.toFixed(1)}/10  ${label}`);
  }
  console.log("");
  console.log(`strongest dimensions:`);
  for (const s of r.strongestDimensions) {
    const label = SUB_DIMENSIONS.find((d) => d.id === s.id)?.label ?? s.id;
    console.log(`  ${s.mean.toFixed(1)}/10  ${label}`);
  }
  console.log("");
}

function enforcePolicy(score: number, opts: ScanOpts, diagnostics: { severity: string }[]) {
  if (opts.minScore !== null && score < opts.minScore) process.exit(1);
  if (opts.failOn === "error" && diagnostics.some((d) => d.severity === "error")) process.exit(1);
  if (opts.failOn === "warning" && diagnostics.some((d) => d.severity === "error" || d.severity === "warning")) process.exit(1);
  process.exit(0);
}

function parseScanArgs(args: string[]): ScanOpts {
  const opts: ScanOpts = {
    path: ".",
    json: false,
    markdown: false,
    strict: false,
    verbose: false,
    full: false,
    scoreOnly: false,
    noColor: !process.stdout.isTTY,
    minScore: null,
    failOn: "none",
    diff: null,
    vision: false,
    url: null,
    routesCap: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--json": opts.json = true; break;
      case "--markdown": opts.markdown = true; break;
      case "--strict": opts.strict = true; break;
      case "--verbose": opts.verbose = true; break;
      case "--full": opts.full = true; break;
      case "--score": opts.scoreOnly = true; break;
      case "--no-color": opts.noColor = true; break;
      case "--vision": opts.vision = true; break;
      case "--url": opts.url = args[++i] ?? null; break;
      case "--routes-cap": opts.routesCap = parseInt(args[++i] ?? "0", 10) || null; break;
      case "--min-score": opts.minScore = parseInt(args[++i] ?? "0", 10); break;
      case "--fail-on": {
        const v = args[++i];
        if (v === "error" || v === "warning" || v === "none") opts.failOn = v;
        break;
      }
      case "--diff": {
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          opts.diff = next;
          i++;
        } else {
          opts.diff = "main";
        }
        break;
      }
      default:
        if (!a.startsWith("--")) opts.path = a;
    }
  }
  return opts;
}
