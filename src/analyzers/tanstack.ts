import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import type { ProjectInfo } from "../types.js";

// We grep route files for the createFileRoute / createRoute factories. Anything
// that looks like a route definition gets inspected for errorComponent /
// pendingComponent / validateSearch / loader.
const CREATE_ROUTE_RE = /\bcreate(?:File|Lazy|Root)?Route\s*\(/;
const HAS_LOADER_RE = /\bloader\s*[:=]/;
const HAS_ERROR_COMP_RE = /\berrorComponent\s*[:=]/;
const HAS_PENDING_COMP_RE = /\bpendingComponent\s*[:=]/;
const HAS_VALIDATE_SEARCH_RE = /\bvalidateSearch\s*[:=]/;
const READS_SEARCH_RE = /\b(?:Route\.useSearch|useSearch|search\s*\.\s*\w+)\b/;
const HAS_SEARCH_PARAMS = /\bsearchSchema\b|\bsearch:\s*z\.|\bsearch:\s*\{/;

export const tanstackAnalyzer: Analyzer = {
  name: "tanstack",
  shouldRun: (p: ProjectInfo) => p.frontendStack === "tanstack" || !!p.tanstackRouterVersion,
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });

    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      if (!CREATE_ROUTE_RE.test(src)) continue;
      const rel = relative(project.root, file);

      const hasLoader = HAS_LOADER_RE.test(src);
      const hasError = HAS_ERROR_COMP_RE.test(src);
      const hasPending = HAS_PENDING_COMP_RE.test(src);
      const hasValidate = HAS_VALIDATE_SEARCH_RE.test(src);
      const readsSearch = READS_SEARCH_RE.test(src);

      // missing-error-component fires whenever a route has a loader (user-facing failure surface)
      // OR whenever it does throw/server work.
      if (hasLoader && !hasError) {
        emit({
          ruleId: "tanstack/missing-error-component",
          message: "Route has a loader but no errorComponent. A failed loader will render a blank screen.",
          file: rel,
        });
      }
      // missing-pending-component fires only when there's a loader.
      if (hasLoader && !hasPending) {
        emit({
          ruleId: "tanstack/missing-pending-component",
          message: "Route has a loader but no pendingComponent. Users see a flash before content loads.",
          file: rel,
        });
      }
      // search-validation fires when the route reads from search but doesn't validate.
      if (readsSearch && !hasValidate && !HAS_SEARCH_PARAMS.test(src)) {
        emit({
          ruleId: "tanstack/search-validation",
          message: "Route reads search params but defines no validateSearch — malformed URLs will crash.",
          file: rel,
        });
      }
    }
  },
};
