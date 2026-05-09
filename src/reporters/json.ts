import type { Diagnostic, ProjectInfo, RunnerResult } from "../types.js";
import { grade as toGrade } from "../score.js";
import { VERSION } from "../version.js";

export interface JsonContext {
  project: ProjectInfo;
  result: RunnerResult & { ranAnalyzers?: string[] };
  score: number;
}

export function renderJson(ctx: JsonContext): string {
  const { project, result, score } = ctx;
  const counts = countSev(result.diagnostics);
  const payload = {
    version: VERSION,
    project: {
      root: project.root,
      frontendRoot: project.frontendRoot,
      stack: project.frontendStack,
      styling: project.styling,
      bundler: project.bundler,
      reactVersion: project.reactVersion,
      tailwindVersion: project.tailwindVersion,
      inertiaVersion: project.inertiaVersion,
      tanstackRouterVersion: project.tanstackRouterVersion,
      hasRails: project.hasRails,
      hasTailwindConfig: project.hasTailwindConfig,
      hasStorybook: project.hasStorybook,
      i18nLib: project.i18nLib,
    },
    score,
    grade: toGrade(score),
    counts,
    stats: {
      totalFindings: result.diagnostics.length,
      affectedFiles: new Set(result.diagnostics.map((d) => d.file).filter(Boolean)).size,
      elapsedMs: result.elapsedMs,
      analyzers: result.ranAnalyzers ?? result.analyzers,
    },
    diagnostics: result.diagnostics,
  };
  return JSON.stringify(payload, null, 2);
}

function countSev(d: Diagnostic[]) {
  const out = { error: 0, warning: 0, info: 0 };
  for (const x of d) out[x.severity]++;
  return out;
}
