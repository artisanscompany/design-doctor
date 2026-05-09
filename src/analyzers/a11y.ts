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

        // a11y/role-redundant — implicit-role override that's just noise.
        const role = el.attrs["role"];
        if (typeof role === "string" && !role.startsWith("{")) {
          const implicit = IMPLICIT_ROLE[el.tag];
          if (implicit && implicit === role) {
            emit({
              ruleId: "a11y/role-redundant",
              message: `<${el.tag} role="${role}"> is redundant — that's already the implicit role.`,
              file: rel,
              line: el.line,
            });
          }
        }

        // a11y/svg-no-title — svg with onClick / role=img / role=button needs
        // an accessible name. Either a <title> child, aria-label, or aria-labelledby.
        if (el.tag === "svg") {
          const role = el.attrs["role"];
          const hasClick = el.attrs["onClick"] !== undefined;
          const ariaHidden = el.attrs["aria-hidden"];
          const interactive = hasClick || role === "img" || role === "button";
          if (interactive && ariaHidden !== "true") {
            const hasTitle = /<title[\s>]/.test(el.text);
            const hasLabel = !!el.attrs["aria-label"] || !!el.attrs["aria-labelledby"];
            if (!hasTitle && !hasLabel) {
              emit({
                ruleId: "a11y/svg-no-title",
                message: `<svg> with role/onClick has no <title> child or aria-label. Screen readers can't name it.`,
                file: rel,
                line: el.line,
              });
            }
          }
        }

        // a11y/empty-heading — heading tag with no static text, no aria-label.
        if (/^h[1-6]$/.test(el.tag) || el.tag === "Heading") {
          const stripped = stripJsxComments(el.text).replace(/<[^>]+>/g, "").replace(/\{[^{}]*\}/g, "").trim();
          const hasAria = !!el.attrs["aria-label"] || !!el.attrs["aria-labelledby"];
          if (!stripped && !hasAria && !el.selfClosing) {
            emit({
              ruleId: "a11y/empty-heading",
              message: `<${el.tag}> renders no static text. Either remove it or set aria-label, otherwise screen-reader users hit a void heading.`,
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

    // a11y/skip-link — top-level layout file (one with both <nav> and <main> or <Outlet>)
    // should expose a skip-to-content link. We do a single best-effort emit when
    // we find a likely layout that has none.
    const layoutFile = guessLayoutFile(files);
    if (layoutFile) {
      let src: string;
      try { src = readFileSync(layoutFile, "utf8"); } catch { src = ""; }
      if (/<nav\b/.test(src) && /(<Outlet\b|<main\b|children\}\s*<\/main)/.test(src)) {
        const hasSkipLink = /sr-only.*?(?:skip[-_ ]?to[-_ ]?content|main)/i.test(src) ||
                            /href="#main"|href="#content"/i.test(src);
        if (!hasSkipLink) {
          emit({
            ruleId: "a11y/skip-link",
            message: "Layout has <nav> but no skip-to-content link. Keyboard users have to tab through every nav item to reach the main content.",
            file: relative(project.root, layoutFile),
          });
        }
      }
    }
  },
};

function guessLayoutFile(files: string[]): string | null {
  // Prefer common layout filenames. We fall back to any TSX containing
  // `<Outlet />` (TanStack/Inertia layouts often render their tree this way).
  const candidates = files.filter((f) =>
    /\b(?:Layout|RootLayout|App|Root|MainLayout)\.(?:tsx|jsx)$/.test(f) ||
    /\b__root\.(?:tsx|jsx)$/.test(f) ||
    /pages\/_app\.(?:tsx|jsx)$/.test(f),
  );
  if (candidates.length) return candidates[0];
  return null;
}

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

// HTML elements with implicit ARIA roles. Setting role= to the same value is
// noise (and sometimes blocks the browser from cleaning up the element).
const IMPLICIT_ROLE: Record<string, string> = {
  button: "button",
  a: "link",
  Link: "link",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  section: "region",
  article: "article",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  thead: "rowgroup",
  tbody: "rowgroup",
  tr: "row",
  td: "cell",
  th: "columnheader",
  img: "img",
  Image: "img",
  form: "form",
};

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
