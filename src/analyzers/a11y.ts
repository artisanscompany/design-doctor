import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import { findElements } from "../jsx.js";
import type { ProjectInfo } from "../types.js";

const ICON_LIKE_RE = /<(?:Icon|Svg|svg|[A-Z][a-zA-Z0-9]*Icon|Lucide[A-Z]\w+)\b/;
const SR_ONLY_RE = /sr-only|visually-hidden|VisuallyHidden/;
const OUTLINE_NONE_RE = /outline\s*:\s*none(?![\w-])|\boutline-none\b/;
const FOCUS_REPLACEMENT_RE = /focus(?:-visible)?:(?:ring|outline|border|shadow)/;
const ON_CLICK_DIV_RE = /<(div|span|li|p|section)\b[^>]*\bonClick\b[^>]*>/g;

const SMALL_TW_SIZE_RE = /\b(?:w|h|size)-(\d+|\[(\d+)px\])\b/g;
const PADDING_TW_RE = /\b(?:p|px|py|pt|pb|pl|pr)-(\d+|\[\d+(?:px|rem)?\])\b/;
const TAILWIND_PADDING_VALUE_RE = /\b(p|px|py|pt|pb|pl|pr)-(\d+)\b/;

export const a11yAnalyzer: Analyzer = {
  name: "a11y",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson,
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });

    let langSeen = false;
    let langChecked = false;

    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      const rel = relative(project.root, file);

      const elements = findElements(src);
      for (const el of elements) {
        // icon-only-button-no-label
        if ((el.tag === "button" || el.tag === "Button") && !el.selfClosing) {
          const innerText = el.text.replace(/<[^>]+>/g, "").trim();
          const hasLabel = !!el.attrs["aria-label"] || !!el.attrs["aria-labelledby"] || !!el.attrs["title"];
          const innerHasIcon = ICON_LIKE_RE.test(el.text);
          const innerHasSrOnly = SR_ONLY_RE.test(el.text);
          if (innerHasIcon && !innerText && !hasLabel && !innerHasSrOnly) {
            emit({
              ruleId: "a11y/icon-only-button-no-label",
              message: `<${el.tag}> contains only an icon and has no aria-label / visible text / sr-only label.`,
              file: rel,
              line: el.line,
            });
          }
        }

        // tap-target-too-small (conservative — only obvious cases)
        if (el.tag === "button" || el.tag === "a" || el.tag === "Button") {
          const cls = (el.attrs["className"] ?? el.attrs["class"]) as string | undefined;
          if (typeof cls === "string" && !cls.startsWith("{")) {
            const padding = TAILWIND_PADDING_VALUE_RE.exec(cls);
            const paddingVal = padding ? parseInt(padding[2], 10) : 0;
            const innerIcon = ICON_LIKE_RE.test(el.text);
            // crude: icon ~16-20px, Tailwind p-1 = 4px, p-2 = 8px. need ≥(44-16)/2 = 14px ≈ p-3.5+.
            if (innerIcon && paddingVal > 0 && paddingVal < 3) {
              emit({
                ruleId: "a11y/tap-target-too-small",
                message: `Icon ${el.tag} with padding p-${paddingVal} likely renders smaller than 44×44.`,
                file: rel,
                line: el.line,
              });
            }
          }
        }

        // onclick-on-div
        if (["div", "span", "li", "p", "section"].includes(el.tag)) {
          const hasClick = el.attrs["onClick"] !== undefined;
          const hasRole = el.attrs["role"] !== undefined;
          const hasTabIndex = el.attrs["tabIndex"] !== undefined || el.attrs["tabindex"] !== undefined;
          const hasKey = el.attrs["onKeyDown"] !== undefined || el.attrs["onKeyUp"] !== undefined || el.attrs["onKeyPress"] !== undefined;
          if (hasClick && (!hasRole || !hasTabIndex || !hasKey)) {
            emit({
              ruleId: "a11y/onclick-on-div",
              message: `<${el.tag} onClick> without role, tabIndex, and a key handler. Use <button> or wire all three.`,
              file: rel,
              line: el.line,
            });
          }
        }

        // (placeholder-as-label is owned by the forms/ analyzer to avoid double-flagging.)

        // lang-missing — only checked on root-y files (layout/_app/root)
        if (el.tag === "html") {
          langChecked = true;
          if (el.attrs["lang"]) langSeen = true;
        }
      }

      // Heading skip — within a single file, levels must increase by exactly 1.
      const seenLevels = collectHeadingLevels(src);
      let prev = 0;
      for (const { level, line } of seenLevels) {
        if (prev && level > prev + 1) {
          emit({
            ruleId: "a11y/heading-skip",
            message: `Heading level jumps from h${prev} to h${level}.`,
            file: rel,
            line,
          });
          break;
        }
        prev = Math.max(prev, level);
      }

      // outline-removed — file-level, look for outline-none without focus replacement nearby.
      if (OUTLINE_NONE_RE.test(src) && !FOCUS_REPLACEMENT_RE.test(src)) {
        const idx = src.search(OUTLINE_NONE_RE);
        emit({
          ruleId: "a11y/outline-removed",
          message: "outline:none / outline-none used without a focus-visible replacement style.",
          file: rel,
          line: lineAt(src, idx),
        });
      }
    }

    if (langChecked && !langSeen) {
      emit({
        ruleId: "a11y/lang-missing",
        message: "<html> tag found without `lang` attribute.",
      });
    }
  },
};

function collectHeadingLevels(src: string): { level: number; line: number }[] {
  const out: { level: number; line: number }[] = [];
  const re = /<h([1-6])\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ level: parseInt(m[1], 10), line: lineAt(src, m.index) });
  }
  return out;
}

function lineAt(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
