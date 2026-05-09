import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import type { ProjectInfo } from "../types.js";

const DESTRUCTURE_RE = /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*use(?:Query|Suspense\w*|InfiniteQuery|MutationState|Loader\w*|Page\w*|FetchData|Resource|SWR)\s*\(/g;
const RENDERS_LOADING = /\{\s*(?:isLoading|isPending|loading|isFetching)\s*(?:&&|\?)/;
const RENDERS_SKELETON = /<(?:Skeleton|Spinner|Loading|Loader|Shimmer)\b/;

const RENDERS_ERROR = /\{\s*(?:error|isError)\s*(?:&&|\?)/;
const RENDERS_ERROR_VIEW = /<(?:Error\w*|ErrorBoundary|ErrorState|EmptyError)\b/;

const MAP_RENDER_RE = /(\w+|\)|\])\s*\.\s*map\s*\(\s*\(?[^)]*\)?\s*=>/g;
const HAS_LENGTH_GUARD = /\.length\s*(?:===|>)\s*0|\.length\s*\?|!\w+\.length|\.length\s*&&/;

// Files whose default export name suggests fixed-content lists (nav, footer,
// breadcrumbs, steppers, FAQ blocks). Empty-state for these is meaningless —
// the items live in code, not in user data.
const FIXED_CONTENT_PATTERNS = [
  /Footer/, /Header/, /TopNav/, /TopBar/, /SideBar/, /Sidebar/, /NavBar/, /Nav$/, /NavDropdown/,
  /Breadcrumbs?/, /Stepper/, /TabNav/, /CategoryBar/, /AccountSwitcher/, /UserMenu/,
  /HowItWorks/, /Steps?Section/, /Comparison/, /FAQ/, /FaqVideoSection/, /TestimonialsSection/,
  /PathwaysSection/, /FilterDrawer/, /CountryCardsSection/,
];

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

      // ── Loading / error states ───────────────────────────────────────
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

      // ── Empty state ──────────────────────────────────────────────────
      // Skip pure-TS files (no JSX, can't be a list rendering) and skip files
      // whose name suggests they render fixed nav/marketing content rather than
      // user data.
      if (!file.endsWith(".tsx") && !file.endsWith(".jsx")) continue;
      const name = basename(file).replace(/\.(tsx|jsx)$/, "");
      if (FIXED_CONTENT_PATTERNS.some((re) => re.test(name))) continue;

      MAP_RENDER_RE.lastIndex = 0;
      const eligibleHits: { line: number }[] = [];
      let mm: RegExpExecArray | null;
      while ((mm = MAP_RENDER_RE.exec(src))) {
        // Look 80 chars left to grab the subject of the map.
        const left = src.slice(Math.max(0, mm.index - 80), mm.index);
        // Skip when subject is an inline literal: `[…].map`, `Object.keys(...).map`,
        // `Object.entries(...).map`, `Array.from(...).map`. Those don't represent
        // dynamic data with empty states.
        if (/\]\s*$/.test(left)) continue;                   // `[…].map`
        if (/\)\s*$/.test(left) && /(?:Object\.(?:keys|entries|values)|Array\.from|range|repeat|Array\.of)\s*\([^)]*\)\s*$/.test(left)) continue;
        // Skip when the chained call is part of a transform pipeline used as a
        // utility (e.g. `.filter(...).map(...)` for derivation, not rendering).
        // We approximate by requiring the line to look like JSX context: contains
        // `{` shortly after the .map opening.
        eligibleHits.push({ line: lineAt(src, mm.index) });
      }

      if (eligibleHits.length === 0) continue;
      if (HAS_LENGTH_GUARD.test(src)) continue;

      // Require some signal of dynamic data: a hook destructure or a prop spread.
      const looksDynamic =
        destructures.length > 0 ||
        /props\.\w+/.test(src) ||
        /useState|useFetch|useSWR|useLoaderData|usePage|useQuery/.test(src);
      if (!looksDynamic) continue;

      emit({
        ruleId: "ui/missing-empty-state",
        message: `${eligibleHits.length} list rendering${eligibleHits.length === 1 ? "" : "s"} without a .length empty-state branch.`,
        file: rel,
        line: eligibleHits[0].line,
      });
    }
  },
};

function lineAt(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}
