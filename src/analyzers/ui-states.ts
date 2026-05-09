import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import type { ProjectInfo } from "../types.js";

const DESTRUCTURE_RE = /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*use(?:Query|Suspense\w*|InfiniteQuery|MutationState|Loader\w*|Page\w*|FetchData|Resource|SWR)\s*\(/g;
const READS_LOADING = /\b(?:isLoading|isPending|loading|isFetching)\b/;
const RENDERS_LOADING = /\{\s*(?:isLoading|isPending|loading|isFetching)\s*(?:&&|\?)/;
const RENDERS_SKELETON = /<(?:Skeleton|Spinner|Loading|Loader|Shimmer)\b/;

const READS_ERROR = /\b(?:error|isError)\b/;
const RENDERS_ERROR = /\{\s*(?:error|isError)\s*(?:&&|\?)/;
const RENDERS_ERROR_VIEW = /<(?:Error\w*|ErrorBoundary|ErrorState|EmptyError)\b/;

const MAP_RENDER_RE = /\.\s*map\s*\(\s*\(?[^)]*\)?\s*=>/g;
const HAS_LENGTH_GUARD = /\.length\s*(?:===|>)\s*0|\.length\s*\?|!\w+\.length/;

export const uiStatesAnalyzer: Analyzer = {
  name: "ui-states",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson,
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });

    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      const rel = relative(project.root, file);

      // Find data-fetching destructures and check whether they read loading/error/data branches.
      DESTRUCTURE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      const destructures: { fields: Set<string>; line: number }[] = [];
      while ((m = DESTRUCTURE_RE.exec(src))) {
        const fields = new Set(
          m[1]
            .split(",")
            .map((s) => s.trim().replace(/[:=].*$/, "").trim())
            .filter(Boolean),
        );
        destructures.push({ fields, line: lineAt(src, m.index) });
      }

      for (const d of destructures) {
        if ((d.fields.has("isLoading") || d.fields.has("isPending") || d.fields.has("loading")) &&
            !RENDERS_LOADING.test(src) && !RENDERS_SKELETON.test(src)) {
          emit({
            ruleId: "ui/missing-loading-state",
            message: "Hook returns isLoading/isPending but the JSX never branches on it (no Skeleton/Spinner either).",
            file: rel,
            line: d.line,
          });
        }
        if ((d.fields.has("error") || d.fields.has("isError")) &&
            !RENDERS_ERROR.test(src) && !RENDERS_ERROR_VIEW.test(src)) {
          emit({
            ruleId: "ui/missing-error-state",
            message: "Hook returns error/isError but the JSX never renders an error branch.",
            file: rel,
            line: d.line,
          });
        }
      }

      // Empty-state heuristic: any `.map()` whose subject is a variable, where the subject
      // appears in a length guard nowhere in the file.
      MAP_RENDER_RE.lastIndex = 0;
      const mapHits: { line: number; src: string }[] = [];
      let mm: RegExpExecArray | null;
      while ((mm = MAP_RENDER_RE.exec(src))) {
        mapHits.push({ line: lineAt(src, mm.index), src: src.slice(Math.max(0, mm.index - 60), mm.index + 80) });
      }
      // Only report once per file to keep noise down.
      if (mapHits.length > 0 && !HAS_LENGTH_GUARD.test(src)) {
        emit({
          ruleId: "ui/missing-empty-state",
          message: `${mapHits.length} list rendering(s) without a .length empty-state branch in this file.`,
          file: rel,
          line: mapHits[0].line,
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
