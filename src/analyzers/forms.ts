import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import { findElements } from "../jsx.js";
import type { ProjectInfo } from "../types.js";

const NUMERIC_HINT_NAMES = /\b(zip|postcode|postal|phone|tel|amount|qty|quantity|count|otp|code|ssn|card|cvv|cvc|year|month|age)\b/i;
const EMAIL_HINT_NAMES = /\b(email|e-mail)\b/i;
const TEL_HINT_NAMES = /\b(phone|tel|mobile)\b/i;
const REQUIRED_VISUAL_RE = /\*\s*$|\(required\)|\brequired\b/i;

export const formsAnalyzer: Analyzer = {
  name: "forms",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson,
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });
    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      const rel = relative(project.root, file);
      const elements = findElements(src);

      for (const el of elements) {
        const isInput = el.tag === "input" || el.tag === "Input" || el.tag === "TextField";
        const isTextarea = el.tag === "textarea" || el.tag === "Textarea";
        if (!(isInput || isTextarea)) continue;

        const name = (el.attrs["name"] ?? "") as string;
        const type = (el.attrs["type"] ?? "") as string;
        const id = el.attrs["id"];
        const placeholder = el.attrs["placeholder"];
        const inputMode = el.attrs["inputMode"] ?? el.attrs["inputmode"];
        const required = el.attrs["required"] !== undefined || el.attrs["aria-required"] !== undefined;
        const ariaDescribedBy = el.attrs["aria-describedby"];

        // forms/label-above-not-placeholder — placeholder present, no <Label htmlFor=id>, no aria-label
        if (placeholder && typeof id === "string") {
          const hasLabelFor = new RegExp(`<[Ll]abel[^>]+htmlFor=["']${escapeRe(id)}["']`).test(src);
          const hasLabelEl = /\<[Ll]abel\b[^>]*>/.test(src);
          const hasAriaLabel = el.attrs["aria-label"] !== undefined;
          if (!hasLabelFor && !hasAriaLabel) {
            emit({
              ruleId: "forms/label-above-not-placeholder",
              message: `${el.tag} (id="${id}") relies on placeholder for labeling${hasLabelEl ? "; htmlFor doesn't reference this id" : ""}.`,
              file: rel,
              line: el.line,
            });
          }
        }

        // forms/missing-inputmode
        const wantsNumeric = NUMERIC_HINT_NAMES.test(name);
        const wantsEmail = EMAIL_HINT_NAMES.test(name);
        const wantsTel = TEL_HINT_NAMES.test(name);
        if ((wantsNumeric || wantsEmail || wantsTel) && !inputMode && !type) {
          const suggested = wantsNumeric ? "numeric" : wantsEmail ? "email" : "tel";
          emit({
            ruleId: "forms/missing-inputmode",
            message: `${el.tag} name="${name}" lacks type=/inputMode= for ${suggested} input.`,
            file: rel,
            line: el.line,
          });
        }

        // forms/required-without-aria — visible asterisk in adjacent label without programmatic required
        if (typeof id === "string" && !required) {
          const labelMatch = new RegExp(`<label[^>]*htmlFor=["']${escapeRe(id)}["'][^>]*>([^<]+)<`).exec(src);
          if (labelMatch && REQUIRED_VISUAL_RE.test(labelMatch[1])) {
            emit({
              ruleId: "forms/required-without-aria",
              message: `Field "${id}" looks required in its label but lacks required / aria-required.`,
              file: rel,
              line: el.line,
            });
          }
        }

        // forms/error-not-associated — heuristic: nearby element with role="alert" or "error" id pattern, but no aria-describedby
        if (typeof id === "string" && !ariaDescribedBy) {
          const errPattern = new RegExp(`id=["']${escapeRe(id)}-error["']|id=["']${escapeRe(id)}_error["']`);
          if (errPattern.test(src)) {
            emit({
              ruleId: "forms/error-not-associated",
              message: `Error message exists for "${id}" but the input lacks aria-describedby="${id}-error".`,
              file: rel,
              line: el.line,
            });
          }
        }
      }

      // forms/submit-without-loading-state — heuristic: `onSubmit` handler in <form>, no isPending/isSubmitting/processing nearby disabling the submit
      const formMatches = src.match(/<form\b[^>]*\bonSubmit/g);
      if (formMatches) {
        const usesLoadingState =
          /(isLoading|isPending|isSubmitting|processing|loading)\s*[}=,]/.test(src) &&
          /disabled=\{/.test(src);
        const usesUseForm = /useForm\s*\(/.test(src);
        if (!usesLoadingState && !usesUseForm) {
          emit({
            ruleId: "forms/submit-without-loading-state",
            message: "<form onSubmit> without a loading/disabled state on the submit button — users can double-submit.",
            file: rel,
          });
        }
      }
    }
  },
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
