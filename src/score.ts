import type { Diagnostic } from "./types.js";

export const PERFECT = 100;
export const ERROR_RULE_PENALTY = 1.5;
export const WARNING_RULE_PENALTY = 0.75;
export const STATIC_CAP_WHEN_VISION = 70;
export const VISION_CONTRIBUTION = 30;

export const GREAT_THRESHOLD = 75;
export const OK_THRESHOLD = 50;
export const BAR_WIDTH = 50;

/**
 * Score = 100 − (unique error rules × 1.5 + unique warning rules × 0.75).
 * Per-unique-rule means one rule firing 100 times still counts once. The
 * score reflects how diverse the breakage is, not how many findings exist.
 */
export function compute(diagnostics: Diagnostic[]): number {
  const errorRules = new Set<string>();
  const warningRules = new Set<string>();
  for (const d of diagnostics) {
    if (d.severity === "error") errorRules.add(d.ruleId);
    else if (d.severity === "warning") warningRules.add(d.ruleId);
  }
  const penalty = errorRules.size * ERROR_RULE_PENALTY + warningRules.size * WARNING_RULE_PENALTY;
  return Math.max(0, Math.round(PERFECT - penalty));
}

/**
 * In vision-aware mode, static is capped at 70. Vision earns the remaining 30.
 * Without --vision, score reports the raw static (capped at 100).
 */
export function computeStaticForVision(diagnostics: Diagnostic[]): number {
  return Math.min(STATIC_CAP_WHEN_VISION, compute(diagnostics));
}

export function grade(score: number): "Great" | "Needs work" | "Critical" {
  if (score >= GREAT_THRESHOLD) return "Great";
  if (score >= OK_THRESHOLD) return "Needs work";
  return "Critical";
}

export function face(score: number): [string, string] {
  if (score >= GREAT_THRESHOLD) return ["◠ ◠", " ▽ "];
  if (score >= OK_THRESHOLD) return ["• •", " ─ "];
  return ["× ×", " ︵ "];
}

export function bar(score: number, width: number = BAR_WIDTH): string {
  const filled = Math.round((score / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
