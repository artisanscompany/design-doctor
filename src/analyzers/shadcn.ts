import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import { findElements } from "../jsx.js";
import type { ProjectInfo } from "../types.js";

// Heuristic: "this project uses shadcn" if components/ui/ exists.
function projectUsesShadcn(project: ProjectInfo): boolean {
  const candidates = [
    `${project.frontendRoot}/components/ui`,
    `${project.frontendRoot}/src/components/ui`,
    `${project.frontendRoot}/app/views/components/ui`,
    `${project.frontendRoot}/app/javascript/components/ui`,
  ];
  for (const c of candidates) {
    try { if (require("node:fs").existsSync(c)) return true; } catch {}
  }
  return false;
}

const SHADCN_PRIMITIVES: Record<string, string> = {
  button: "Button",
  input: "Input",
  label: "Label",
  textarea: "Textarea",
  select: "Select",
};

// Tailwind utilities that conflict with `variant=` choices on shadcn primitives.
// Setting `bg-*`/`text-*`/`border-*` while also picking a variant means you're
// overriding the design system's intent.
const VARIANT_AXIS_RE = /\b(bg-(?!gradient)|text-(?!xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|center|left|right|justify|wrap|nowrap|truncate|ellipsis|balance)|border-(?!t|r|b|l|0|2|4|8)|hover:bg-|hover:text-)\S+/g;

export const shadcnAnalyzer: Analyzer = {
  name: "shadcn",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson && projectUsesShadcn(p),
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });

    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      const rel = relative(project.root, file);
      // The shadcn base components themselves legitimately use raw HTML and
      // do their own className composition — skip them.
      if (/(?:^|\/)components\/ui\//.test(rel) || /(?:^|\/)ui\/[^/]+\.(?:tsx|jsx)$/.test(rel)) continue;

      const importsCn = /\bimport\s+\{\s*cn\s*\}|\bimport\s+\{[^}]*\bcn\b/.test(src);
      const importsShadcn = /from\s+["'][^"']*\/components\/ui\/[^"']+["']/.test(src) ||
                            /from\s+["']@\/components\/ui\/[^"']+["']/.test(src);
      const elements = findElements(src);

      // Track which shadcn equivalents are imported in this file so we only
      // suggest "use Button" when Button is actually around.
      const importedShadcnTags = new Set<string>();
      for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+["'][^"']*\/components\/ui\//g)) {
        for (const name of m[1].split(",").map((s) => s.trim().replace(/\s+as\s+\w+/, "")).filter(Boolean)) {
          importedShadcnTags.add(name);
        }
      }

      for (const el of elements) {
        // shadcn/raw-html-with-shadcn — suggest the primitive when the equivalent is imported in the same file
        const equivalent = SHADCN_PRIMITIVES[el.tag];
        if (equivalent && importedShadcnTags.has(equivalent)) {
          // Skip <button> with `type="submit"` if the file's hosting form uses native form actions.
          // Best-effort: still flag — the primitive supports `type="submit"` too.
          emit({
            ruleId: "shadcn/raw-html-with-shadcn",
            message: `<${el.tag}> used in a file that already imports <${equivalent}> from components/ui. Use the primitive for consistent styling.`,
            file: rel,
            line: el.line,
          });
        }

        // shadcn/variant-fighting — variant=… plus same-axis className overrides
        const variant = el.attrs["variant"];
        const cls = el.attrs["className"] ?? el.attrs["class"];
        if (typeof variant === "string" && !variant.startsWith("{") && typeof cls === "string" && !cls.startsWith("{")) {
          const overrides = (cls.match(VARIANT_AXIS_RE) ?? []).slice(0, 4);
          if (overrides.length > 0) {
            emit({
              ruleId: "shadcn/variant-fighting",
              message: `<${el.tag} variant="${variant}"> is overriding the variant with className="… ${overrides.join(" ")} …". Pick one source of truth.`,
              file: rel,
              line: el.line,
            });
          }
        }

        // shadcn/cn-helper-recommended — className built with template literal or string concat
        // Detect: className={`...`} or className={x + ...} when the file uses shadcn.
        if (typeof cls === "string" && cls.startsWith("{")) {
          const expr = cls.slice(1, -1);
          if (importsShadcn) {
            // Template literal with interpolation, or string concat with `+`.
            const looksConcat = (/`[^`]*\$\{/.test(expr) || /['"]\s*\+\s*/.test(expr)) && !/\bcn\s*\(/.test(expr);
            if (looksConcat && !importsCn) {
              emit({
                ruleId: "shadcn/cn-helper-recommended",
                message: `${el.tag}'s className is composed by string concat/template-literal. Use cn(...) (from @/lib/utils) so Tailwind merge resolves conflicts.`,
                file: rel,
                line: el.line,
              });
            }
          }
        }
      }
    }
  },
};
