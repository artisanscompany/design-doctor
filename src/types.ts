export type Severity = "error" | "warning" | "info";

export type Category =
  | "design"
  | "copy"
  | "a11y"
  | "forms"
  | "ui"
  | "inertia"
  | "tanstack"
  | "stack"
  | "shadcn";

export interface Rule {
  id: string;
  title: string;
  category: Category;
  defaultSeverity: Severity;
  fix?: string;
  docUrl?: string;
  description?: string;
}

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  category: Category;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  fix?: string;
}

export type FrontendStack = "tanstack" | "inertia" | "react" | "unknown";
export type Bundler = "vite" | "webpack" | "esbuild" | "rspack" | "unknown";
export type StylingSystem = "tailwind" | "css-modules" | "styled-components" | "emotion" | "vanilla-extract" | "plain" | "unknown";

export interface ProjectInfo {
  root: string;
  frontendRoot: string;
  hasRails: boolean;
  hasPackageJson: boolean;
  frontendStack: FrontendStack;
  bundler: Bundler;
  styling: StylingSystem;
  hasTailwindConfig: boolean;
  hasStorybook: boolean;
  hasI18nLib: boolean;
  i18nLib?: string;
  reactVersion?: string;
  tailwindVersion?: string;
  inertiaVersion?: string;
  tanstackRouterVersion?: string;
  packageJson?: Record<string, unknown>;
}

export interface RunnerOptions {
  verbose: boolean;
  diffFiles?: string[] | null;
}

export interface RunnerResult {
  diagnostics: Diagnostic[];
  analyzers: string[];
  scannedFiles: number;
  totalFiles: number;
  elapsedMs: number;
}

export interface UxDoctorConfig {
  preset: "default" | "strict" | "minimal";
  allow: string[];
  disable: string[];
  severity: Record<string, Severity>;
  thresholds: {
    colorClusterMinSize: number;
    fontWeightMaxCardinality: number;
    fontFamilyMaxCardinality: number;
    zIndexMaxCardinality: number;
    shadowMaxCardinality: number;
  };
  routes: string[];
  url?: string;
}
