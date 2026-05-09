import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, REACT_EXT } from "../walk.js";
import type { ProjectInfo } from "../types.js";

// className extraction. We match string-literal className values only; dynamic
// ones (`{cn(...)}`, template literals) are skipped — that's the cn() / shadcn
// analyzer's territory.
const CLASS_LITERAL_RE = /className=["']([^"']+)["']/g;

// Conflicting utility families: any pair from a family causes a conflict. We
// require *two distinct* matchers from the same family to fire — single-pattern
// families can't conflict with themselves.
const CONFLICT_FAMILIES: Array<[string, RegExp[]]> = [
  ["display", [
    /(?:^|\s)block(?=\s|$)/,
    /(?:^|\s)inline-block(?=\s|$)/,
    /(?:^|\s)inline-flex(?=\s|$)/,
    /(?:^|\s)inline(?=\s|$)/,           // bare `inline` only
    /(?:^|\s)flex(?=\s|$)/,             // bare `flex` only (not flex-col, flex-row — those are direction utilities)
    /(?:^|\s)grid(?=\s|$)/,
    /(?:^|\s)hidden(?=\s|$)/,
  ]],
  ["position",  [/\bstatic\b/, /\bfixed\b/, /\babsolute\b/, /\brelative\b/, /\bsticky\b/]],
  ["text-align",[/\btext-left\b/, /\btext-center\b/, /\btext-right\b/, /\btext-justify\b/]],
];

// Padding / margin axis conflicts at the same variant level only. We anchor on
// (^|space) so prefixed variants (`lg:px-8 lg:first:pl-0`) — which are legit
// intentional overrides — don't trip the rule.
const SPACING_PAIRS: Array<[RegExp, RegExp[]]> = [
  [/(?:^|\s)px-\d+/, [/(?:^|\s)pl-\d+/, /(?:^|\s)pr-\d+/]],
  [/(?:^|\s)py-\d+/, [/(?:^|\s)pt-\d+/, /(?:^|\s)pb-\d+/]],
  [/(?:^|\s)mx-\d+/, [/(?:^|\s)ml-\d+/, /(?:^|\s)mr-\d+/]],
  [/(?:^|\s)my-\d+/, [/(?:^|\s)mt-\d+/, /(?:^|\s)mb-\d+/]],
];

// "no-effect" hover: hover:bg-X where the base is also bg-X (matching token).
const HOVER_NOOP_RE = /\b(?:bg|text|border)-(\S+)\s+(?:[\w:-]*\s+)*hover:(?:bg|text|border)-\1\b/;

const DUPLICATE_MIN_TOKENS = 6;        // only flag long-ish strings
const DUPLICATE_MIN_OCCURRENCES = 5;   // ≥5 uses across files = candidate for extraction

export const classesAnalyzer: Analyzer = {
  name: "classes",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson && p.styling === "tailwind",
  async run(ctx: AnalyzerContext) {
    const { project, options, emit } = ctx;
    const files = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });

    // Per-file checks (conflicts, no-effect hover) + global tally for duplicates.
    const stringTally = new Map<string, { count: number; firstFile: string; firstLine: number }>();

    for (const file of files) {
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      const rel = relative(project.root, file);

      CLASS_LITERAL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CLASS_LITERAL_RE.exec(src))) {
        const cls = m[1].trim();
        if (!cls) continue;
        const line = lineAt(src, m.index);

        // Conflicting families — pick at most one diagnostic per className.
        const conflict = findConflict(cls);
        if (conflict) {
          emit({
            ruleId: "design/conflicting-classes",
            message: `Conflicting ${conflict.family} utilities in className: ${conflict.matches.join(", ")}. Pick one.`,
            file: rel,
            line,
          });
        } else {
          const spacingConflict = findSpacingConflict(cls);
          if (spacingConflict) {
            emit({
              ruleId: "design/conflicting-classes",
              message: `Spacing conflict: ${spacingConflict.join(" + ")} fight each other. Drop the broader one or specify each side.`,
              file: rel,
              line,
            });
          }
        }

        if (HOVER_NOOP_RE.test(cls)) {
          emit({
            ruleId: "design/hover-no-effect",
            message: `className has hover:* matching its base — there's no visible state change. ${cls.slice(0, 80)}`,
            file: rel,
            line,
          });
        }

        // Tally for duplicate-string detection.
        const tokens = cls.split(/\s+/).filter(Boolean);
        if (tokens.length < DUPLICATE_MIN_TOKENS) continue;
        // Normalize order so reordered class lists count as the same string.
        const key = [...tokens].sort().join(" ");
        const prev = stringTally.get(key);
        if (prev) {
          prev.count++;
        } else {
          stringTally.set(key, { count: 1, firstFile: rel, firstLine: line });
        }
      }
    }

    // Emit duplicate-string findings.
    const duplicates = [...stringTally.entries()]
      .filter(([, info]) => info.count >= DUPLICATE_MIN_OCCURRENCES)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8);
    for (const [key, info] of duplicates) {
      emit({
        ruleId: "design/duplicated-class-string",
        message: `Same Tailwind class set used ${info.count}× across the codebase (${key.split(" ").length} tokens) — extract to a component or shared variant.`,
        file: info.firstFile,
        line: info.firstLine,
      });
    }
  },
};

function findConflict(cls: string): { family: string; matches: string[] } | null {
  for (const [family, patterns] of CONFLICT_FAMILIES) {
    const matches = patterns
      .map((re) => cls.match(re)?.[0])
      .filter((s): s is string => !!s);
    if (matches.length >= 2) return { family, matches };
  }
  return null;
}

function findSpacingConflict(cls: string): string[] | null {
  for (const [broad, narrow] of SPACING_PAIRS) {
    const broadMatch = cls.match(broad)?.[0]?.trim();
    if (!broadMatch) continue;
    for (const n of narrow) {
      const nMatch = cls.match(n)?.[0]?.trim();
      if (nMatch) return [broadMatch, nMatch];
    }
  }
  return null;
}

function lineAt(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}
