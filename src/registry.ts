import type { Category, Rule, Severity } from "./types.js";

const RULES = new Map<string, Rule>();

export function defineRule(r: Rule): Rule {
  if (RULES.has(r.id)) throw new Error(`Duplicate rule id: ${r.id}`);
  RULES.set(r.id, r);
  return r;
}

export function fetchRule(id: string): Rule {
  const r = RULES.get(id);
  if (!r) throw new Error(`Unknown rule: ${id}`);
  return r;
}

export function allRules(): Rule[] {
  return Array.from(RULES.values());
}

export function categoriesInUse(): Category[] {
  const set = new Set<Category>();
  for (const r of RULES.values()) set.add(r.category);
  return Array.from(set);
}

// Helper used by analyzers to register rules and produce diagnostics in one shot.
export interface DiagnosticInput {
  ruleId: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  fix?: string;
  severity?: Severity;
}
