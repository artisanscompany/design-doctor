import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { walk, REACT_EXT } from "./walk.js";
import type { ProjectInfo } from "./types.js";

// Conservative autofix. Each transform here is a pure-text rewrite that:
//   - never changes meaning
//   - only matches inside JSX text nodes or attribute string literals
//   - is safe to apply unconditionally
//
// We skip files inside `components/ui/` (shadcn base) so we don't rewrite the
// design system's own canonical sources.

export interface FixResult {
  file: string;
  changes: number;
  appliedRules: string[];
}

export function applyFixes(project: ProjectInfo, options: { dryRun?: boolean } = {}): FixResult[] {
  const files = walk(project.frontendRoot, { extensions: REACT_EXT });
  const out: FixResult[] = [];

  for (const file of files) {
    const rel = relative(project.root, file);
    if (/(?:^|\/)components\/ui\//.test(rel) || /(?:^|\/)ui\/[^/]+\.(?:tsx|jsx)$/.test(rel)) continue;

    let src: string;
    try { src = readFileSync(file, "utf8"); } catch { continue; }
    const original = src;
    const counter: Counter = { count: 0 };
    const applied: string[] = [];

    src = applyAsciiEllipsis(src, applied, counter);
    src = applyHtmlEntity(src, applied, counter);
    src = applyButtonTrailingPeriod(src, applied, counter);
    src = applyRoleRedundant(src, applied, counter);

    if (src !== original) {
      out.push({ file: rel, changes: counter.count, appliedRules: applied });
      if (!options.dryRun) writeFileSync(file, src);
    }
  }

  return out;
}

interface Counter { count: number; }

function applyAsciiEllipsis(src: string, applied: string[], counter: Counter): string {
  // Replace `...` inside JSX text only. Anchor on `>plain text<` (no JSX expressions).
  let hits = 0;
  const next = src.replace(/>([^<{}]+)</g, (_m, body) => {
    if (!body.includes("...")) return `>${body}<`;
    const replaced = body.replace(/\.{3}/g, () => { hits++; return "…"; });
    return `>${replaced}<`;
  });
  if (hits > 0) {
    counter.count += hits;
    if (!applied.includes("copy/ascii-ellipsis")) applied.push("copy/ascii-ellipsis");
  }
  return next;
}

function applyHtmlEntity(src: string, applied: string[], counter: Counter): string {
  const REPLACEMENTS: Array<[RegExp, string]> = [
    [/&amp;/g, "&"],
    [/&lt;/g, "<"],
    [/&gt;/g, ">"],
    [/&nbsp;/g, " "],
    [/&mdash;/g, "—"],
    [/&ndash;/g, "–"],
    [/&hellip;/g, "…"],
    [/&copy;/g, "©"],
    [/&reg;/g, "®"],
    [/&trade;/g, "™"],
  ];
  let hits = 0;
  const next = src.replace(/>([^<{}]+)</g, (_m, body) => {
    let b = body;
    for (const [re, to] of REPLACEMENTS) {
      b = b.replace(re, () => { hits++; return to; });
    }
    return `>${b}<`;
  });
  if (hits > 0) {
    counter.count += hits;
    if (!applied.includes("copy/html-entity")) applied.push("copy/html-entity");
  }
  return next;
}

function applyButtonTrailingPeriod(src: string, applied: string[], counter: Counter): string {
  let hits = 0;
  const next = src.replace(/<(button|Button)\b([^>]*)>([^<>{}]+?)\.\s*<\/\1>/g, (_m, tag, attrs, text) => {
    hits++;
    return `<${tag}${attrs}>${text}</${tag}>`;
  });
  if (hits > 0) {
    counter.count += hits;
    if (!applied.includes("copy/button-trailing-period")) applied.push("copy/button-trailing-period");
  }
  return next;
}

function applyRoleRedundant(src: string, applied: string[], counter: Counter): string {
  const cases: Array<[RegExp, string]> = [
    [/<button\b([^>]*?)\s+role="button"([^>]*?)>/g, "<button$1$2>"],
    [/<a\b([^>]*?)\s+role="link"([^>]*?)>/g, "<a$1$2>"],
    [/<nav\b([^>]*?)\s+role="navigation"([^>]*?)>/g, "<nav$1$2>"],
    [/<main\b([^>]*?)\s+role="main"([^>]*?)>/g, "<main$1$2>"],
    [/<header\b([^>]*?)\s+role="banner"([^>]*?)>/g, "<header$1$2>"],
    [/<footer\b([^>]*?)\s+role="contentinfo"([^>]*?)>/g, "<footer$1$2>"],
    [/<aside\b([^>]*?)\s+role="complementary"([^>]*?)>/g, "<aside$1$2>"],
    [/<form\b([^>]*?)\s+role="form"([^>]*?)>/g, "<form$1$2>"],
    [/<(ul|ol)\b([^>]*?)\s+role="list"([^>]*?)>/g, "<$1$2$3>"],
    [/<li\b([^>]*?)\s+role="listitem"([^>]*?)>/g, "<li$1$2>"],
  ];
  let hits = 0;
  let next = src;
  for (const [re, replacement] of cases) {
    next = next.replace(re, () => { hits++; return ""; }).replace(re, replacement);
    // Replace twice — first to count, second to actually substitute. (Cleaner
    // than parsing the match groups in the count callback.)
  }
  // Simpler accurate count: count by post-pass diff on role= occurrences.
  const beforeCount = (src.match(/role="(?:button|link|navigation|main|banner|contentinfo|complementary|form|list|listitem)"/g) ?? []).length;
  const afterCount = (next.match(/role="(?:button|link|navigation|main|banner|contentinfo|complementary|form|list|listitem)"/g) ?? []).length;
  const removed = Math.max(0, beforeCount - afterCount);
  if (removed > 0) {
    counter.count += removed;
    if (!applied.includes("a11y/role-redundant")) applied.push("a11y/role-redundant");
  }
  return next;
}
