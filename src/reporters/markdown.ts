import type { Diagnostic, ProjectInfo, RunnerResult } from "../types.js";
import { grade as toGrade } from "../score.js";
import { fetchRule } from "../registry.js";

export interface MdContext {
  project: ProjectInfo;
  result: RunnerResult & { ranAnalyzers?: string[] };
  score: number;
}

export function renderMarkdown(ctx: MdContext): string {
  const { project, result, score } = ctx;
  const lines: string[] = [];
  lines.push(`## design-doctor report`);
  lines.push("");
  lines.push(`**Score: ${score}/100 — ${toGrade(score)}**`);
  lines.push("");
  lines.push(`Stack: \`${project.frontendStack}\` · Styling: \`${project.styling}\` · Bundler: \`${project.bundler}\``);
  if (project.hasRails) lines.push(`Companion: Rails detected — run rails-doctor for the Ruby side.`);
  lines.push("");

  if (result.diagnostics.length === 0) {
    lines.push("All checks passed.");
    return lines.join("\n");
  }

  const counts = countSev(result.diagnostics);
  lines.push(`error: ${counts.error} · warning: ${counts.warning} · info: ${counts.info}`);
  lines.push("");

  const byCategory = groupBy(result.diagnostics, (d) => d.category);
  const cats = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [cat, ds] of cats) {
    lines.push(`### ${cat} (${ds.length})`);
    const byRule = groupBy(ds, (d) => d.ruleId);
    for (const [ruleId, hits] of byRule) {
      const rule = safeRule(ruleId);
      lines.push(`- **${rule.title}** \`${ruleId}\` (×${hits.length})`);
      if (rule.fix) lines.push(`  - _Fix:_ ${rule.fix}`);
      for (const h of hits.slice(0, 5)) {
        lines.push(`  - \`${h.file ?? ""}${h.line ? `:${h.line}` : ""}\` — ${h.message}`);
      }
      if (hits.length > 5) lines.push(`  - …(+${hits.length - 5} more)`);
    }
    lines.push("");
  }
  return lines.join("\n");
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

function countSev(d: Diagnostic[]) {
  const out = { error: 0, warning: 0, info: 0 };
  for (const x of d) out[x.severity]++;
  return out;
}
