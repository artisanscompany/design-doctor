import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".vite",
  ".turbo",
  ".cache",
  ".ux-doctor",
  "vendor",
  "tmp",
  "public",
  "storybook-static",
]);

export interface WalkOptions {
  extensions: Set<string>;
  maxDepth?: number;
  diffFiles?: string[] | null;
}

export function walk(root: string, opts: WalkOptions): string[] {
  const out: string[] = [];
  const max = opts.maxDepth ?? 12;
  const diff = opts.diffFiles ? new Set(opts.diffFiles.map(normalizeRel)) : null;

  function visit(dir: string, depth: number) {
    if (depth > max) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") && name !== ".storybook") continue;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        visit(full, depth + 1);
      } else if (st.isFile()) {
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
        if (!opts.extensions.has(ext)) continue;
        if (diff) {
          const rel = normalizeRel(relative(root, full));
          if (!diff.has(rel)) continue;
        }
        out.push(full);
      }
    }
  }

  visit(root, 0);
  return out;
}

function normalizeRel(p: string): string {
  return p.split(sep).join("/");
}

export const REACT_EXT = new Set([".tsx", ".jsx", ".ts", ".js", ".cts", ".mts", ".cjs", ".mjs"]);
export const STYLE_EXT = new Set([".css", ".scss", ".sass", ".less", ".styl", ".pcss"]);
export const ALL_FRONTEND_EXT = new Set([...REACT_EXT, ...STYLE_EXT]);
