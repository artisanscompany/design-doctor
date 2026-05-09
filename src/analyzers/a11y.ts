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
        // Fire when:
        //   - the element has an icon child
        //   - the icon child has a known small Tailwind size (w-3/h-3 to w-5/h-5)
        //   - and total padding (p-* + child size + child size) likely renders < 44px
        if (el.tag === "button" || el.tag === "a" || el.tag === "Button") {
          const cls = (el.attrs["className"] ?? el.attrs["class"]) as string | undefined;
          if (typeof cls === "string" && !cls.startsWith("{")) {
            const padding = TAILWIND_PADDING_VALUE_RE.exec(cls);
            const paddingVal = padding ? parseInt(padding[2], 10) : 0;
            // Look at the inner JSX for a w-N or size-N on the icon. Tailwind v4: 1 unit = 4px.
            const innerSizeMatch = el.text.match(/\b(?:w|size)-(\d+)\b/);
            const innerSizeVal = innerSizeMatch ? parseInt(innerSizeMatch[1], 10) : NaN;
            if (
              !Number.isNaN(innerSizeVal) &&
              innerSizeVal <= 5 &&         // icon ≤20px
              paddingVal > 0 &&            // some explicit padding (else we don't know)
              paddingVal < 3               // p-1/p-2 → total ≤32px
            ) {
              const totalPx = innerSizeVal * 4 + paddingVal * 4 * 2;
              emit({
                ruleId: "a11y/tap-target-too-small",
                message: `Icon ${el.tag} with p-${paddingVal} around w-${innerSizeVal} icon ≈ ${totalPx}px — below the 44×44 minimum.`,
                file: rel,
                line: el.line,
              });
            }
          }
        }

        // img alt-text quality
        if (el.tag === "img" || el.tag === "Image") {
          const alt = el.attrs["alt"];
          const role = el.attrs["role"];
          const ariaHidden = el.attrs["aria-hidden"];
          const decorativeOptOut = role === "presentation" || role === "none" || ariaHidden === "true";

          if (alt === undefined && !decorativeOptOut) {
            emit({
              ruleId: "a11y/img-without-alt",
              message: `<${el.tag}> has no alt attribute. Add a descriptive alt="…" or alt="" + role="presentation" if decorative.`,
              file: rel,
              line: el.line,
            });
          } else if (typeof alt === "string" && !alt.startsWith("{") && alt.trim().length > 0) {
            const lazy = isLazyAlt(alt);
            if (lazy) {
              emit({
                ruleId: "a11y/lazy-alt-text",
                message: `<${el.tag} alt="${alt}"> — ${lazy}`,
                file: rel,
                line: el.line,
              });
            }
          }
        }

        // a11y/link-purpose-unclear — anchors with empty/vague text and no aria-label.
        if (el.tag === "a" || el.tag === "Link") {
          const visibleText = stripJsxComments(el.text).replace(/<[^>]+>/g, "").trim();
          const hasLabel = !!el.attrs["aria-label"] || !!el.attrs["aria-labelledby"] || !!el.attrs["title"];
          if (!hasLabel) {
            const lower = visibleText.toLowerCase();
            const vague = lower === "" ||
              lower === "click here" ||
              lower === "here" ||
              lower === "read more" ||
              lower === "learn more" ||
              lower === "more" ||
              lower === "details" ||
              lower === ">";
            if (visibleText.length > 0 && vague) {
              emit({
                ruleId: "a11y/link-purpose-unclear",
                message: `<${el.tag}> with text "${visibleText}" gives no context out of flow. Screen-reader users browsing a links list see only the text.`,
                file: rel,
                line: el.line,
              });
            }
          }
        }

        // a11y/label-without-for — bare <label>foo</label> with no htmlFor and no nested input.
        if (el.tag === "label") {
          const hasFor = !!el.attrs["htmlFor"];
          const wraps = /<input\b|<select\b|<textarea\b/.test(el.text);
          if (!hasFor && !wraps) {
            emit({
              ruleId: "a11y/label-without-for",
              message: `<label> has no htmlFor and doesn't wrap an input. The browser can't associate it with anything.`,
              file: rel,
              line: el.line,
            });
          }
        }

        // shadcn/dialog-without-description — DialogContent / SheetContent / AlertDialogContent
        // without a paired description for screen readers. Common shadcn a11y miss.
        if (el.tag === "DialogContent" || el.tag === "SheetContent" || el.tag === "AlertDialogContent") {
          const hasDesc = /<(?:Dialog|Sheet|AlertDialog)Description\b/.test(el.text) ||
                          el.attrs["aria-describedby"] !== undefined;
          if (!hasDesc) {
            emit({
              ruleId: "shadcn/dialog-without-description",
              message: `<${el.tag}> renders without a <${el.tag.replace("Content", "Description")}> child. Radix warns about this; screen readers lose context.`,
              file: rel,
              line: el.line,
            });
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

function stripJsxComments(s: string): string {
  return s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

const LAZY_ALT_WORDS = new Set([
  "image", "img", "picture", "photo", "graphic", "icon", "logo", "avatar", "thumbnail", "thumb", "banner",
]);

function isLazyAlt(alt: string): string | null {
  const trimmed = alt.trim().toLowerCase();
  if (LAZY_ALT_WORDS.has(trimmed)) {
    return `"${alt}" is a generic word, not a description. Describe what's in the image or what it represents.`;
  }
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(trimmed)) {
    return `alt looks like a filename. Describe the image, don't restate the file path.`;
  }
  if (trimmed.startsWith("image of ") || trimmed.startsWith("picture of ") || trimmed.startsWith("photo of ")) {
    return `Drop "image of"/"picture of" — screen readers already announce the role.`;
  }
  return null;
}
