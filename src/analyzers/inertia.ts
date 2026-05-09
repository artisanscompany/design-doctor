import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import { findElements } from "../jsx.js";
import type { ProjectInfo } from "../types.js";

const INERTIA_RENDER_RE = /\b(?:render|InertiaController#render)\s+inertia:\s*["']([^"']+)["']/g;
const INERTIA_RENDER_RB_RE = /\brender\s+inertia:\s*["']([^"']+)["']/g;

export const inertiaAnalyzer: Analyzer = {
  name: "inertia",
  shouldRun: (p: ProjectInfo) => p.frontendStack === "inertia" || (!!p.inertiaVersion),
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;

    // 1. Internal-link rule + useForm rule — scan React files.
    const reactFiles = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });
    for (const file of reactFiles) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      const rel = relative(project.root, file);

      // links-not-anchors — flag <a href="/internal/path"> that isn't <Link>
      const elements = findElements(src);
      for (const el of elements) {
        if (el.tag === "a") {
          const href = el.attrs["href"];
          if (typeof href === "string" && !href.startsWith("{") && href.startsWith("/") && !href.startsWith("//")) {
            emit({
              ruleId: "inertia/links-not-anchors",
              message: `<a href="${href}"> for internal navigation; full reload. Use Inertia <Link>.`,
              file: rel,
              line: el.line,
            });
          }
        }
        // form-uses-useForm — only fires when:
        //   - the file imports something from @inertiajs/react (so it's actually an Inertia page), AND
        //   - the file does not already use a form library (Inertia useForm OR react-hook-form OR formik)
        if (el.tag === "form" && el.attrs["onSubmit"] !== undefined) {
          const isInertiaContext = /from\s+["']@inertiajs\/react["']/.test(src);
          const usesAnyFormLib = /\buseForm\s*[(<]/.test(src) || /\buseFormContext\s*\(/.test(src) || /\bformik\b/i.test(src);
          if (isInertiaContext && !usesAnyFormLib) {
            emit({
              ruleId: "inertia/form-uses-useform",
              message: "Inertia page uses <form onSubmit> directly without a form library. useForm() carries CSRF + form.errors + form.processing for free.",
              file: rel,
              line: el.line,
            });
          }
        }
      }
    }

    // 2. page-component-naming — only if Rails side is present.
    if (project.hasRails) {
      const controllers = walk(join(project.root, "app", "controllers"), { extensions: new Set([".rb"]), diffFiles: options.diffFiles });
      const renderedPages = new Set<string>();
      for (const file of controllers) {
        let src: string;
        try { src = readFileSync(file, "utf8"); } catch { continue; }
        INERTIA_RENDER_RB_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = INERTIA_RENDER_RB_RE.exec(src))) renderedPages.add(m[1]);
      }
      const pagesRoot = locatePagesDir(project.frontendRoot);
      if (pagesRoot && renderedPages.size > 0) {
        const componentPaths = new Set(
          collectFiles(pagesRoot, REACT_EXT)
            .map((f) => normalizePagePath(relative(pagesRoot, f))),
        );
        for (const page of renderedPages) {
          if (!componentPaths.has(page)) {
            emit({
              ruleId: "inertia/page-component-naming",
              message: `Controller renders inertia: "${page}" but no matching component found under ${relative(project.root, pagesRoot)}/.`,
            });
          }
        }
      }
    }
  },
};

function locatePagesDir(frontendRoot: string): string | null {
  const candidates = [
    join(frontendRoot, "pages"),
    join(frontendRoot, "Pages"),
    join(frontendRoot, "components", "pages"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function collectFiles(dir: string, exts: Set<string>): string[] {
  const out: string[] = [];
  const entries = (() => { try { return readdirSync(dir); } catch { return []; }})();
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...collectFiles(full, exts));
    else if (st.isFile()) {
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
      if (exts.has(ext)) out.push(full);
    }
  }
  return out;
}

function normalizePagePath(rel: string): string {
  return rel.replace(/\.(tsx|ts|jsx|js)$/, "").replace(/\\/g, "/");
}
