import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Bundler, FrontendStack, ProjectInfo, StylingSystem } from "./types.js";

const FRONTEND_DIR_CANDIDATES = [
  "app/frontend",
  "app/javascript",
  "frontend",
  "client",
  "web",
  "src",
];

export function detectProject(root: string): ProjectInfo {
  const rootAbs = resolve(root);
  const hasRails = existsSync(join(rootAbs, "Gemfile")) && existsSync(join(rootAbs, "config", "routes.rb"));
  const pkgPath = join(rootAbs, "package.json");
  const hasPackageJson = existsSync(pkgPath);
  const pkg = hasPackageJson ? safeJson(pkgPath) : undefined;
  const deps = depsOf(pkg);

  const frontendRoot = locateFrontendRoot(rootAbs, hasRails);

  const frontendStack = detectFrontendStack(deps, frontendRoot);
  const bundler = detectBundler(deps, rootAbs);
  const styling = detectStyling(deps, rootAbs, frontendRoot);
  const hasTailwindConfig = hasFile(rootAbs, [
    "tailwind.config.js",
    "tailwind.config.ts",
    "tailwind.config.cjs",
    "tailwind.config.mjs",
  ]) || (frontendRoot !== rootAbs && hasFile(frontendRoot, [
    "tailwind.config.js",
    "tailwind.config.ts",
  ]));
  const hasStorybook = existsSync(join(rootAbs, ".storybook")) || existsSync(join(frontendRoot, ".storybook"));

  const i18nLib = pickI18nLib(deps);

  return {
    root: rootAbs,
    frontendRoot,
    hasRails,
    hasPackageJson,
    frontendStack,
    bundler,
    styling,
    hasTailwindConfig,
    hasStorybook,
    hasI18nLib: i18nLib !== undefined,
    i18nLib,
    reactVersion: deps["react"],
    tailwindVersion: deps["tailwindcss"],
    inertiaVersion: deps["@inertiajs/react"] || deps["@inertiajs/inertia-react"],
    tanstackRouterVersion: deps["@tanstack/react-router"] || deps["@tanstack/router"],
    packageJson: pkg,
  };
}

export function isFrontendApp(p: ProjectInfo): boolean {
  return p.hasPackageJson && p.frontendStack !== "unknown";
}

function safeJson(p: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
}

function depsOf(pkg: Record<string, unknown> | undefined): Record<string, string> {
  if (!pkg) return {};
  const out: Record<string, string> = {};
  for (const key of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const obj = pkg[key];
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, string>)) out[k] = v;
    }
  }
  return out;
}

function locateFrontendRoot(root: string, hasRails: boolean): string {
  if (!hasRails) return root;
  for (const candidate of FRONTEND_DIR_CANDIDATES) {
    const p = join(root, candidate);
    if (existsSync(p) && statSync(p).isDirectory()) {
      // Need at least one .tsx/.jsx in the tree to call it a frontend root
      if (containsReactFiles(p)) return p;
    }
  }
  return root;
}

function containsReactFiles(dir: string, depth = 0): boolean {
  if (depth > 4) return false;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && /\.(tsx|jsx)$/.test(name)) return true;
    if (st.isDirectory() && containsReactFiles(full, depth + 1)) return true;
  }
  return false;
}

function detectFrontendStack(deps: Record<string, string>, frontendRoot: string): FrontendStack {
  if (deps["@tanstack/react-router"] || deps["@tanstack/router"] || deps["@tanstack/start"]) return "tanstack";
  if (deps["@inertiajs/react"] || deps["@inertiajs/inertia-react"] || hasFile(frontendRoot, ["pages"])) {
    if (deps["@inertiajs/react"] || deps["@inertiajs/inertia-react"]) return "inertia";
  }
  if (deps["react"]) return "react";
  return "unknown";
}

function detectBundler(deps: Record<string, string>, root: string): Bundler {
  if (deps["vite"] || hasFile(root, ["vite.config.ts", "vite.config.js"])) return "vite";
  if (deps["webpack"]) return "webpack";
  if (deps["esbuild"]) return "esbuild";
  if (deps["@rspack/core"]) return "rspack";
  return "unknown";
}

function detectStyling(deps: Record<string, string>, root: string, frontendRoot: string): StylingSystem {
  if (deps["tailwindcss"]) return "tailwind";
  if (deps["styled-components"]) return "styled-components";
  if (deps["@emotion/react"] || deps["@emotion/styled"]) return "emotion";
  if (deps["@vanilla-extract/css"]) return "vanilla-extract";
  if (hasFile(root, ["postcss.config.js", "postcss.config.cjs"])) return "plain";
  if (hasFile(frontendRoot, ["styles", "css"])) return "plain";
  return "unknown";
}

function hasFile(dir: string, names: string[]): boolean {
  return names.some((n) => existsSync(join(dir, n)));
}

function pickI18nLib(deps: Record<string, string>): string | undefined {
  if (deps["i18next"] || deps["react-i18next"]) return "i18next";
  if (deps["react-intl"]) return "react-intl";
  if (deps["next-intl"]) return "next-intl";
  if (deps["@lingui/react"]) return "lingui";
  return undefined;
}
