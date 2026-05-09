import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectInfo, UxDoctorConfig } from "../types.js";

export interface DiscoveredRoute {
  path: string;          // URL path, e.g. "/", "/pricing", "/admin/users/:id"
  source: "config" | "tanstack" | "rails" | "fallback";
  templateOnly?: boolean; // true if path contains :params and we have no sample
  sampleParams?: Record<string, string>; // optional substitutions for :params
}

export interface DiscoveryOptions {
  cap: number; // max routes to keep
}

export function discoverRoutes(
  project: ProjectInfo,
  config: UxDoctorConfig,
  options: DiscoveryOptions,
): DiscoveredRoute[] {
  // 1. Explicit list always wins.
  if (config.routes.length > 0) {
    return config.routes.slice(0, options.cap).map((path) => ({ path, source: "config" }));
  }
  // 2. TanStack file-based router.
  if (project.frontendStack === "tanstack") {
    const tsr = discoverTanStackRoutes(project);
    if (tsr.length > 0) return tsr.slice(0, options.cap);
  }
  // 3. Rails routes for Inertia apps.
  if (project.frontendStack === "inertia" && project.hasRails) {
    const rails = discoverRailsRoutes(project);
    if (rails.length > 0) return rails.slice(0, options.cap);
  }
  // 4. Fallback — just "/".
  return [{ path: "/", source: "fallback" }];
}

function discoverTanStackRoutes(project: ProjectInfo): DiscoveredRoute[] {
  const candidates = [
    join(project.frontendRoot, "src", "routes"),
    join(project.frontendRoot, "app", "routes"),
    join(project.frontendRoot, "routes"),
  ];
  let routesDir: string | null = null;
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) { routesDir = c; break; }
  }
  if (!routesDir) return [];

  const files = collectFiles(routesDir).filter((f) => /\.(tsx|ts|jsx|js)$/.test(f));
  const out: DiscoveredRoute[] = [];
  for (const file of files) {
    const rel = relative(routesDir, file).replace(/\.(tsx|ts|jsx|js)$/, "").replace(/\\/g, "/");
    const path = tanstackFileToPath(rel);
    if (path === null) continue;
    out.push({ path, source: "tanstack", templateOnly: path.includes(":") });
  }
  // Dedup, sorted by depth then alpha so "/" comes first.
  const seen = new Set<string>();
  return out
    .filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
}

function tanstackFileToPath(rel: string): string | null {
  // TanStack file conventions:
  //   __root  → skip (layout root)
  //   index   → "/"
  //   posts.index → "/posts"
  //   posts.$postId → "/posts/:postId"
  //   _authed.dashboard → "/dashboard" (pathless layout)
  //   foo.bar → "/foo/bar"
  if (rel === "__root" || rel.endsWith("/__root")) return null;
  if (rel === "index") return "/";

  // Tanstack uses `.` as path separator. `_segment` is a pathless layout — skip from path.
  const parts = rel.split(".").filter((p) => !p.startsWith("_") && p !== "index");
  const last = rel.split(".").at(-1);
  const trailingIndex = last === "index";

  const built = parts
    .map((p) => (p.startsWith("$") ? `:${p.slice(1)}` : p))
    .join("/");

  let path = "/" + built;
  if (path === "/" || path === "") path = "/";
  if (trailingIndex && path !== "/") path = path; // index already collapses to dir
  return path;
}

function discoverRailsRoutes(project: ProjectInfo): DiscoveredRoute[] {
  // Try `bin/rails routes` first; fall back to parsing config/routes.rb (lossy).
  try {
    const out = execSync("bin/rails routes 2>/dev/null", {
      cwd: project.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
    return parseRailsRoutesTable(out);
  } catch {
    return parseRailsRoutesFile(project);
  }
}

function parseRailsRoutesTable(table: string): DiscoveredRoute[] {
  // Table format: PREFIX VERB URI PATTERN CONTROLLER#ACTION
  // We pick GET routes returning HTML (skip /rails/, JSON-ish controllers, mounted engines).
  const lines = table.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: DiscoveredRoute[] = [];
  for (const line of lines) {
    const tokens = line.split(/\s+/);
    if (tokens.length < 4) continue;
    const verb = tokens.find((t) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(t));
    if (verb !== "GET") continue;
    const pat = tokens.find((t) => t.startsWith("/")) ?? "";
    if (!pat) continue;
    if (pat.startsWith("/rails/") || pat.startsWith("/cable") || pat.startsWith("/assets")) continue;
    if (pat.includes("(.:format)")) {
      const clean = pat.replace("(.:format)", "");
      out.push({
        path: clean.replace(/:(\w+)/g, ":$1"),
        source: "rails",
        templateOnly: clean.includes(":"),
      });
    }
  }
  // Dedup + sort.
  const seen = new Set<string>();
  return out
    .filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
}

function parseRailsRoutesFile(project: ProjectInfo): DiscoveredRoute[] {
  const path = join(project.root, "config", "routes.rb");
  if (!existsSync(path)) return [];
  let src: string;
  try { src = readFileSync(path, "utf8"); } catch { return []; }
  const out: DiscoveredRoute[] = [];
  // Best-effort: pull out get "..." and root "..." declarations.
  for (const m of src.matchAll(/^\s*root\s+["']([^"']+)["']/gm)) out.push({ path: "/", source: "rails" });
  for (const m of src.matchAll(/^\s*get\s+["']([^"']+)["']/gm)) {
    let p = m[1];
    if (!p.startsWith("/")) p = "/" + p;
    out.push({ path: p, source: "rails" });
  }
  // Resources is too lossy without the rails routes table — skip.
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...collectFiles(full));
    else if (st.isFile()) out.push(full);
  }
  return out;
}

export function routeSlug(path: string): string {
  if (path === "/") return "root";
  return path
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
}
