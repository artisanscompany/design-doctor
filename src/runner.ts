import type { Diagnostic, ProjectInfo, RunnerOptions, RunnerResult, UxDoctorConfig } from "./types.js";
import { isDisabled, severityFor } from "./config.js";
import { fetchRule } from "./registry.js";
import type { DiagnosticInput } from "./registry.js";

export interface AnalyzerContext {
  project: ProjectInfo;
  config: UxDoctorConfig;
  options: RunnerOptions;
  emit: (input: DiagnosticInput) => void;
}

export interface Analyzer {
  name: string;
  shouldRun: (project: ProjectInfo) => boolean;
  run: (ctx: AnalyzerContext) => Promise<void> | void;
}

export class Runner {
  private analyzers: Analyzer[];
  constructor(
    private project: ProjectInfo,
    private config: UxDoctorConfig,
    private options: RunnerOptions,
    analyzers: Analyzer[],
  ) {
    this.analyzers = analyzers;
  }

  async run(): Promise<RunnerResult & { ranAnalyzers: string[] }> {
    const start = Date.now();
    const diagnostics: Diagnostic[] = [];
    const ranAnalyzers: string[] = [];
    const fileCounts = { scanned: 0, total: 0 };

    const emit = (input: DiagnosticInput) => {
      if (isDisabled(this.config, input.ruleId)) return;
      const rule = fetchRule(input.ruleId);
      const severity = input.severity ?? severityFor(this.config, input.ruleId, rule.defaultSeverity);
      diagnostics.push({
        ruleId: input.ruleId,
        severity,
        category: rule.category,
        message: input.message,
        file: input.file,
        line: input.line,
        column: input.column,
        fix: input.fix ?? rule.fix,
      });
    };

    for (const a of this.analyzers) {
      if (!a.shouldRun(this.project)) continue;
      ranAnalyzers.push(a.name);
      try {
        await a.run({
          project: this.project,
          config: this.config,
          options: this.options,
          emit,
        });
      } catch (e) {
        // Analyzers must not crash the run. Emit a diagnostic-style note.
        const msg = e instanceof Error ? e.message : String(e);
        diagnostics.push({
          ruleId: "stack/analyzer-failed",
          severity: "info",
          category: "stack",
          message: `analyzer "${a.name}" failed: ${msg}`,
        });
      }
    }

    return {
      diagnostics,
      analyzers: ranAnalyzers,
      ranAnalyzers,
      scannedFiles: fileCounts.scanned,
      totalFiles: fileCounts.total,
      elapsedMs: Date.now() - start,
    };
  }
}
