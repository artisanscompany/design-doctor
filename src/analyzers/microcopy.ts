import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import { findElements, isUserFacingString, iterText, stripJsxExpressions } from "../jsx.js";
import type { ProjectInfo } from "../types.js";

const BANNED_PHRASES: { pattern: RegExp; suggestion: string }[] = [
  { pattern: /\bclick\s+here\b/i, suggestion: "Replace \"Click here\" with a descriptive label that names the destination." },
  { pattern: /\blearn\s+more\b/i, suggestion: "\"Learn more\" alone is poor for screen readers. Name what you'll learn (e.g. \"Read pricing details\")." },
  { pattern: /\bread\s+more\b/i, suggestion: "Specify what's being expanded (e.g. \"Read full review\")." },
  { pattern: /\bsubmit\b/i, suggestion: "\"Submit\" is generic. Name the verb specifically (\"Save\", \"Send invite\", \"Create account\")." },
];

const NON_INCLUSIVE_PHRASES: { pattern: RegExp; suggestion: string }[] = [
  { pattern: /\bwhitelist(ed|ing)?\b/i, suggestion: "Use \"allowlist\" / \"allowed\"." },
  { pattern: /\bblacklist(ed|ing)?\b/i, suggestion: "Use \"blocklist\" / \"blocked\"." },
  { pattern: /\bmaster\b/i, suggestion: "Prefer \"primary\", \"main\", or \"source\" depending on context." },
  { pattern: /\bslave\b/i, suggestion: "Use \"replica\" / \"secondary\" / \"follower\"." },
  { pattern: /\bdummy\b/i, suggestion: "Use \"placeholder\" or \"sample\"." },
  { pattern: /\bcrazy\b/i, suggestion: "Use \"surprising\", \"unexpected\", or describe the actual issue." },
  { pattern: /\binsane\b/i, suggestion: "Use specific language about what's actually happening." },
];

const HTML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|copy|reg|trade);/g;
const ASCII_ELLIPSIS_RE = /\.{3,}/;
const ASCII_QUOTES_RE = /(?:^|\s)"[^"]+"|(?:^|\s)'[^']+'/;
const TERMINAL_PUNCT_RE = /[.!?…]\s*$/;

const TOAST_LIKE_TAGS = new Set(["Toast", "Alert", "Notification", "Banner", "Snackbar"]);
const BUTTON_LIKE_TAGS = new Set(["Button", "button", "SubmitButton", "Cta", "CTA"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "Heading"]);

const HARDCODED_TEXT_NEAR_T_RE = /\bt\(\s*["'`]/;
const HARDCODED_TRANS_RE = /<Trans\b/;

export const microcopyAnalyzer: Analyzer = {
  name: "microcopy",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson,
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });
    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      const rel = relative(project.root, file);
      analyzeFile(src, rel, ctx);
    }
  },
};

function analyzeFile(src: string, rel: string, ctx: AnalyzerContext) {
  const { emit, project } = ctx;
  const i18nDetected = !!project.i18nLib && (HARDCODED_TEXT_NEAR_T_RE.test(src) || HARDCODED_TRANS_RE.test(src));

  // Walk JSX elements once and route to per-tag rules.
  const elements = findElements(src);
  for (const el of elements) {
    const text = stripJsxExpressions(el.text).trim();
    const inlineStrings = collectInlineStrings(el.attrs, ["aria-label", "alt", "placeholder", "title"]);

    // We only treat plain-text buttons as CTAs. If a button contains nested JSX
    // (e.g. icon + text), grading the visible label requires DOM rendering — skip.
    const plainText = isPlainText(el.text) ? text : "";

    // CTA / button rules — plain-text only.
    if (BUTTON_LIKE_TAGS.has(el.tag) && plainText) {
      const wc = wordCount(plainText);
      if (wc > 4 || /[.!](?:\s|$)/.test(plainText)) {
        emit({ ruleId: "copy/cta-too-long", message: `Button text "${truncate(plainText, 60)}" is ${wc > 4 ? wc + " words" : "sentence-shaped"}.`, file: rel, line: el.line });
      }
      if (/\.\s*$/.test(plainText)) {
        emit({ ruleId: "copy/button-trailing-period", message: `Button label "${truncate(plainText, 60)}" ends with a period.`, file: rel, line: el.line });
      }
    }

    // Toast/alert punctuation — plain-text only.
    if (TOAST_LIKE_TAGS.has(el.tag) && plainText) {
      if (wordCount(plainText) > 5 && !TERMINAL_PUNCT_RE.test(plainText)) {
        emit({ ruleId: "copy/toast-punctuation", message: `Toast/alert text "${truncate(plainText, 80)}" is missing terminal punctuation.`, file: rel, line: el.line });
      }
    }

    // copy/exclamation-overuse — visible text with multiple ! or hyperbolic phrasing.
    // Fires only on real user-facing slots (button text, toast/alert text, attribute strings).
    const exclaimCandidates = [plainText, ...inlineStrings].filter((s) => s && isUserFacingString(s));
    for (const s of exclaimCandidates) {
      if (/!{2,}/.test(s)) {
        emit({
          ruleId: "copy/exclamation-overuse",
          message: `"${truncate(s, 80)}" contains repeated "!". Pick one — UI doesn't need to shout.`,
          file: rel,
          line: el.line,
        });
        break; // one diagnostic per element is enough
      }
    }

    // copy/redundant-error-prefix — toast/alert text starts with "Error:"/"Invalid:"/"Sorry,".
    if ((TOAST_LIKE_TAGS.has(el.tag) || el.tag === "AlertTitle" || el.tag === "ToastTitle") && plainText) {
      if (/^(?:error|invalid|sorry|oops|warning|failure)[:!,]/i.test(plainText)) {
        emit({
          ruleId: "copy/redundant-error-prefix",
          message: `"${truncate(plainText, 80)}" — drop the "${plainText.match(/^[A-Za-z]+/)?.[0]}" prefix. Tone is set by the alert styling, not the text.`,
          file: rel,
          line: el.line,
        });
      }
    }

    // Banned phrases only fire on real CTAs (plain-text button labels) or
    // visible attribute strings (aria-label, alt, placeholder, title). Arbitrary
    // JSX text fragments are too noisy and contain too many false positives.
    const ctaCandidates: string[] = [];
    if ((BUTTON_LIKE_TAGS.has(el.tag) || el.tag === "a" || el.tag === "Link") && plainText) {
      ctaCandidates.push(plainText);
    }
    ctaCandidates.push(...inlineStrings.filter((s) => isUserFacingString(s)));
    for (const s of ctaCandidates) {
      for (const { pattern, suggestion } of BANNED_PHRASES) {
        if (pattern.test(s)) {
          emit({ ruleId: "copy/banned-phrase", message: `"${truncate(s, 80)}" — ${suggestion}`, file: rel, line: el.line });
        }
      }
    }

    // Inclusive language + ASCII typography apply to any visible string —
    // those are real text the user reads regardless of element shape.
    const visibleStrings = [plainText, ...inlineStrings].filter((s) => s && isUserFacingString(s));
    for (const s of visibleStrings) {
      for (const { pattern, suggestion } of NON_INCLUSIVE_PHRASES) {
        if (pattern.test(s)) {
          emit({ ruleId: "copy/inclusive-language", message: `"${truncate(s, 80)}" — ${suggestion}`, file: rel, line: el.line });
        }
      }
      if (ASCII_ELLIPSIS_RE.test(s)) {
        emit({ ruleId: "copy/ascii-ellipsis", message: `"${truncate(s, 80)}" uses ASCII "..."`, file: rel, line: el.line });
      }
      if (HTML_ENTITY_RE.test(s)) {
        emit({ ruleId: "copy/html-entity", message: `"${truncate(s, 80)}" contains an HTML entity that should be a Unicode char in JSX.`, file: rel, line: el.line });
      }
    }
  }

  // i18n leak — only if project has an i18n stack AND it's TanStack
  // (Inertia apps often translate server-side and pass via shared props).
  if (project.i18nLib && project.frontendStack === "tanstack") {
    const seenLeak = new Set<string>();
    for (const { text, index } of iterText(src)) {
      const stripped = stripJsxExpressions(text).trim();
      if (!isUserFacingString(stripped)) continue;
      if (wordCount(stripped) < 3) continue;
      if (HARDCODED_TEXT_NEAR_T_RE.test(stripped) || stripped.startsWith("<Trans")) continue;
      const key = stripped.slice(0, 80);
      if (seenLeak.has(key)) continue;
      seenLeak.add(key);
      const line = lineFor(src, index);
      emit({ ruleId: "copy/i18n-leak", message: `Visible string "${truncate(stripped, 80)}" is not wrapped in t() or <Trans>`, file: rel, line });
      if (seenLeak.size > 8) break;
    }
  }
}

function collectInlineStrings(attrs: Record<string, string | true>, names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const v = attrs[n];
    if (typeof v === "string" && !v.startsWith("{")) out.push(v);
  }
  return out;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function isPlainText(s: string): boolean {
  // True when the JSX child block contains only text + whitespace + JSX
  // expression containers — no nested elements. Used to avoid treating a button
  // wrapping an icon + text as a single label.
  const stripped = s.replace(/\{[^{}]*\}/g, "");
  return !/<[A-Za-z]/.test(stripped);
}

function lineFor(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}
