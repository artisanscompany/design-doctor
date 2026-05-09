import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import type { ProjectInfo } from "../types.js";

const DEVTOOLS_RE = /<(?:ReactQueryDevtools|TanStackRouterDevtools|ReduxDevtools|XStateDevtools)\b/;
const ENV_GUARD_RE = /import\.meta\.env\.DEV|process\.env\.NODE_ENV\s*[!=]==?\s*['"]production['"]|isDev|__DEV__/;

export const stackAnalyzer: Analyzer = {
  name: "stack",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson,
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });

    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      if (!DEVTOOLS_RE.test(src)) continue;
      const rel = relative(project.root, file);

      // Devtools without env guard. Look for ENV_GUARD_RE *near* the devtools render.
      const idx = src.search(DEVTOOLS_RE);
      const around = src.slice(Math.max(0, idx - 200), idx + 200);
      if (!ENV_GUARD_RE.test(around) && !ENV_GUARD_RE.test(src)) {
        emit({
          ruleId: "stack/devtools-in-prod",
          message: "Devtools component rendered without an environment guard — production users will see it.",
          file: rel,
          line: lineAt(src, idx),
        });
      }
    }
  },
};

function lineAt(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}
