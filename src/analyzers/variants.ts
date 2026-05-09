import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import { findElements } from "../jsx.js";
import type { ProjectInfo } from "../types.js";

// Components for which a healthy design system has a small, fixed set of
// variants. We collect every literal `variant=` value across the codebase.
// Files in `components/ui/` (shadcn base components) define the legitimate
// vocabulary — we don't count those, only the consumers.
const VARIANT_COMPONENTS = ["Button", "Badge", "Alert", "Card", "Tag", "Chip", "Pill", "Banner"];

const REASONABLE_CARDINALITY: Record<string, number> = {
  Button: 6,    // default, secondary, ghost, outline, destructive, link
  Badge: 4,
  Alert: 4,
  Card: 3,
  Tag: 4,
  Chip: 4,
  Pill: 4,
  Banner: 3,
};

export const variantsAnalyzer: Analyzer = {
  name: "variants",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson,
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });

    // tag → variant value → list of {file, line}
    const seen = new Map<string, Map<string, { file: string; line: number }[]>>();
    for (const tag of VARIANT_COMPONENTS) seen.set(tag, new Map());

    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      const rel = relative(project.root, file);
      // Don't count the design system's own definition file as a "use site".
      if (/(?:^|\/)components\/ui\//.test(rel) || /(?:^|\/)ui\/[^/]+\.(?:tsx|jsx)$/.test(rel)) continue;

      const elements = findElements(src, (t) => VARIANT_COMPONENTS.includes(t));
      for (const el of elements) {
        const v = el.attrs["variant"];
        if (typeof v !== "string" || v.startsWith("{")) continue;
        const variantMap = seen.get(el.tag)!;
        const list = variantMap.get(v) ?? [];
        list.push({ file: rel, line: el.line });
        variantMap.set(v, list);
      }
    }

    for (const [tag, variantMap] of seen) {
      const variants = [...variantMap.entries()];
      if (variants.length === 0) continue;
      const cap = REASONABLE_CARDINALITY[tag] ?? 4;
      if (variants.length <= cap) continue;
      // Sort by usage so the rarest variants surface first — those are the
      // ones most likely to be drift.
      variants.sort((a, b) => a[1].length - b[1].length);
      const list = variants.map(([v, hits]) => `${v}(${hits.length})`).join(", ");
      const sample = variants[0][1][0];
      emit({
        ruleId: "design/variant-sprawl",
        message: `<${tag}> used with ${variants.length} distinct variants — ${list}. Pick a small set.`,
        file: sample?.file,
        line: sample?.line,
      });
    }
  },
};
