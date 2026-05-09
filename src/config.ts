import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Severity, UxDoctorConfig } from "./types.js";

const DEFAULTS: UxDoctorConfig = {
  preset: "default",
  allow: [],
  disable: [],
  severity: {},
  thresholds: {
    colorClusterMinSize: 3,
    fontWeightMaxCardinality: 4,
    fontFamilyMaxCardinality: 2,
    zIndexMaxCardinality: 6,
    shadowMaxCardinality: 5,
  },
  routes: [],
};

const FILENAMES = [
  ".uxdoctor.json",
  "uxdoctor.config.json",
  ".ux-doctor.json",
];

export function loadConfig(root: string): UxDoctorConfig {
  for (const name of FILENAMES) {
    const p = join(root, name);
    if (existsSync(p)) return mergeConfig(DEFAULTS, parseJson(p));
  }
  return DEFAULTS;
}

function parseJson(path: string): Partial<UxDoctorConfig> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<UxDoctorConfig>;
  } catch {
    return {};
  }
}

function mergeConfig(base: UxDoctorConfig, over: Partial<UxDoctorConfig>): UxDoctorConfig {
  return {
    preset: over.preset ?? base.preset,
    allow: over.allow ?? base.allow,
    disable: over.disable ?? base.disable,
    severity: { ...base.severity, ...(over.severity ?? {}) },
    thresholds: { ...base.thresholds, ...(over.thresholds ?? {}) },
    routes: over.routes ?? base.routes,
    url: over.url ?? base.url,
  };
}

export function severityFor(config: UxDoctorConfig, ruleId: string, defaultSev: Severity): Severity {
  return config.severity[ruleId] ?? defaultSev;
}

export function isDisabled(config: UxDoctorConfig, ruleId: string): boolean {
  if (config.disable.includes(ruleId)) return true;
  if (config.disable.includes(ruleId.split("/")[0])) return true;
  return false;
}

export function isAllowed(config: UxDoctorConfig, key: string): boolean {
  return config.allow.includes(key);
}
