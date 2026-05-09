import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Analyzer, AnalyzerContext } from "../runner.js";
import { walk, ALL_FRONTEND_EXT, REACT_EXT, STYLE_EXT } from "../walk.js";
import { colorHue, deltaE, parseColor, type RGB } from "../color.js";
import type { ProjectInfo } from "../types.js";

// Color literals — anything that smells like a CSS color in CSS, JSX or
// inline-style strings. Tailwind arbitrary-value colors (`bg-[#abc]`) are
// scooped up by the second pass.
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:[\s,]+[\d.]+%?)?\s*\)/gi;
const HSL_RE = /hsla?\(\s*[\d.]+\s*,?\s*[\d.]+%?\s*,?\s*[\d.]+%?(?:\s*,?\s*[\d.]+%?)?\s*\)/gi;

const ARBITRARY_TW_RE = /\b(?:[a-z]+:)*(?:p|m|gap|w|h|text|leading|tracking|rounded|border|bg|from|to|via|ring|space|top|left|right|bottom|inset|translate|rotate|skew|scale|opacity|z|grid-cols|grid-rows|aspect)-(?:x|y|t|r|b|l)?-?\[([^\]]+)\]/g;

const FONT_WEIGHT_RE = /font-weight\s*:\s*([^;}\n]+)/gi;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}\n]+)/gi;
const TW_FONT_WEIGHT_RE = /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g;

const Z_INDEX_CSS_RE = /z-index\s*:\s*(-?\d+)/gi;
const TW_Z_RE = /\bz-(\d+|\[(-?\d+)\])\b/g;

const SHADOW_CSS_RE = /box-shadow\s*:\s*([^;}\n]+)/gi;
const TW_SHADOW_RE = /\bshadow-(?:sm|md|lg|xl|2xl|inner|none|\[[^\]]+\])\b/g;

const TAILWIND_DARK_BG_RE = /\bbg-(?!\[)\S+/g; // any non-arbitrary bg-*
const TAILWIND_DARK_PAIR_RE = /\bdark:bg-\S+/g;

const PX_RE = /\b\d+px\b/;
const REM_RE = /\b\d+(?:\.\d+)?rem\b/;

export const designTokensAnalyzer: Analyzer = {
  name: "design-tokens",
  shouldRun: (p: ProjectInfo) => p.hasPackageJson,
  async run(ctx: AnalyzerContext) {
    const { project, config, options, emit } = ctx;

    // 1. Detect token source first — drives the no-token-source rule.
    const hasTokens =
      project.hasTailwindConfig ||
      project.styling === "vanilla-extract" ||
      cssCustomPropertiesPresent(project) ||
      project.styling === "tailwind";

    const reactFiles = walk(project.frontendRoot, { extensions: REACT_EXT, diffFiles: options.diffFiles });
    const styleFiles = walk(project.frontendRoot, { extensions: STYLE_EXT, diffFiles: options.diffFiles });

    // 2. Collect all color literals across React + style files.
    const colorSamples: { color: RGB; raw: string; file: string; line: number }[] = [];
    const arbitraryHits: { file: string; line: number; cls: string }[] = [];
    const fontWeights = new Map<string, number>();
    const fontFamilies = new Map<string, number>();
    const zIndexValues = new Map<number, number>();
    const shadowSignatures = new Map<string, number>();
    const filesByMixedUnit = new Map<string, { px: number; rem: number; lines: { line: number; raw: string }[] }>();
    const filesByUnpairedDark = new Map<string, number>();
    let projectHasDarkVariants = false;

    const allFiles = [...reactFiles, ...styleFiles];
    const FILE_CAP = 4000; // safety net for huge monorepos
    const scanFiles = allFiles.slice(0, FILE_CAP);

    for (const file of scanFiles) {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const rel = relative(project.root, file);
      const lines = src.split("\n");

      for (const re of [HEX_RE, RGB_RE, HSL_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          const c = parseColor(m[0]);
          if (c) {
            const { line } = locate(src, m.index);
            colorSamples.push({ color: c, raw: m[0], file: rel, line });
          }
        }
      }

      ARBITRARY_TW_RE.lastIndex = 0;
      let mm: RegExpExecArray | null;
      while ((mm = ARBITRARY_TW_RE.exec(src))) {
        const { line } = locate(src, mm.index);
        arbitraryHits.push({ file: rel, line, cls: mm[0] });
      }

      // Font weight / family — normalize Tailwind weight names → numeric so
      // `font-bold` and `font-weight: 700` count as one.
      FONT_WEIGHT_RE.lastIndex = 0;
      let fw: RegExpExecArray | null;
      while ((fw = FONT_WEIGHT_RE.exec(src))) bump(fontWeights, normalizeWeight(fw[1].trim().replace(/[;,]+$/, "")));
      TW_FONT_WEIGHT_RE.lastIndex = 0;
      while ((fw = TW_FONT_WEIGHT_RE.exec(src))) bump(fontWeights, normalizeWeight(fw[1]));
      FONT_FAMILY_RE.lastIndex = 0;
      let ff: RegExpExecArray | null;
      while ((ff = FONT_FAMILY_RE.exec(src))) bump(fontFamilies, normalizeFamily(ff[1]));

      // Z-index.
      Z_INDEX_CSS_RE.lastIndex = 0;
      let zm: RegExpExecArray | null;
      while ((zm = Z_INDEX_CSS_RE.exec(src))) bumpNum(zIndexValues, parseInt(zm[1], 10));
      TW_Z_RE.lastIndex = 0;
      while ((zm = TW_Z_RE.exec(src))) {
        const v = parseInt(zm[2] ?? zm[1], 10);
        if (!Number.isNaN(v)) bumpNum(zIndexValues, v);
      }

      // Shadows.
      SHADOW_CSS_RE.lastIndex = 0;
      let sm: RegExpExecArray | null;
      while ((sm = SHADOW_CSS_RE.exec(src))) bump(shadowSignatures, normalizeShadow(sm[1]));
      TW_SHADOW_RE.lastIndex = 0;
      while ((sm = TW_SHADOW_RE.exec(src))) bump(shadowSignatures, sm[0]);

      // Mixed units inside a single file (skip 1px borders).
      const px = src.match(/\b\d+px\b/g)?.filter((s) => s !== "1px") ?? [];
      const rem = src.match(/\b\d+(?:\.\d+)?rem\b/g) ?? [];
      if (px.length > 0 && rem.length > 0) {
        const sample: { line: number; raw: string }[] = [];
        for (let i = 0; i < lines.length && sample.length < 3; i++) {
          if (PX_RE.test(lines[i]) && lines.slice(Math.max(0, i - 4), i + 5).some((l) => REM_RE.test(l))) {
            sample.push({ line: i + 1, raw: lines[i].trim().slice(0, 100) });
          }
        }
        filesByMixedUnit.set(rel, { px: px.length, rem: rem.length, lines: sample });
      }

      // Dark-mode pairing — only meaningful when project uses Tailwind. We
      // collect both sides and decide globally below: if no file *outside the
      // shadcn/ui base components* has any `dark:` class, the project doesn't
      // ship dark mode (shadcn ships dark variants by default).
      if (project.styling === "tailwind") {
        const bgs = (src.match(TAILWIND_DARK_BG_RE) ?? []).filter((s) => !s.startsWith("dark:"));
        const dark = src.match(TAILWIND_DARK_PAIR_RE) ?? [];
        if (bgs.length >= 4 && dark.length === 0) {
          filesByUnpairedDark.set(rel, bgs.length);
        }
        if (dark.length > 0 && !isShadcnBaseComponent(rel)) projectHasDarkVariants = true;
      }
    }

    // === EMIT ===

    if (!hasTokens && project.styling !== "tailwind") {
      emit({
        ruleId: "design/no-token-source",
        message: "No tailwind.config / CSS custom properties / vanilla-extract theme found. Colors and spacing live as inline literals — they will sprawl.",
        file: project.frontendRoot,
      });
    }

    // Cluster colors. Bucket by hue first, then run ΔE within each bucket. We
    // exclude pure black / pure white opacity ladders (`rgba(0,0,0,*)`) — those
    // are usually an intentional overlay scale, not sprawl.
    const COLOR_CAP = 1000;
    const sampled = colorSamples.filter((s) => !isOverlayOpacityLadder(s.raw)).slice(0, COLOR_CAP);
    const clusters = clusterColors(sampled);
    const minCluster = config.thresholds.colorClusterMinSize ?? 3;
    for (const cluster of clusters) {
      if (cluster.length < minCluster) continue;
      const distinctRaw = new Set(cluster.map((c) => c.raw.toLowerCase()));
      if (distinctRaw.size < 2) continue;
      const sample = cluster[0];
      emit({
        ruleId: "design/color-cluster",
        message: `${distinctRaw.size} near-duplicate colors clustered around ${sample.raw} (${cluster.length} uses): ${[...distinctRaw].slice(0, 6).join(", ")}${distinctRaw.size > 6 ? "…" : ""}`,
        file: sample.file,
        line: sample.line,
      });
    }

    // Arbitrary Tailwind values — one diagnostic per file (not per hit) to keep noise down.
    const arbitraryByFile = groupBy(arbitraryHits, (h) => h.file);
    for (const [file, hits] of arbitraryByFile) {
      const samples = hits.slice(0, 3).map((h) => h.cls).join(", ");
      const noun = hits.length === 1 ? "value bypasses" : "values bypass";
      emit({
        ruleId: "design/arbitrary-tailwind-value",
        message: `${hits.length} arbitrary Tailwind ${noun} the scale (${samples}${hits.length > 3 ? "…" : ""})`,
        file,
        line: hits[0].line,
      });
    }

    if (fontWeights.size > config.thresholds.fontWeightMaxCardinality) {
      emit({
        ruleId: "design/font-weight-cardinality",
        message: `${fontWeights.size} distinct font weights in use: ${[...fontWeights.keys()].slice(0, 8).join(", ")}${fontWeights.size > 8 ? "…" : ""}`,
        file: project.frontendRoot,
      });
    }
    if (fontFamilies.size > config.thresholds.fontFamilyMaxCardinality) {
      emit({
        ruleId: "design/font-family-cardinality",
        message: `${fontFamilies.size} distinct font families in use`,
        file: project.frontendRoot,
      });
    }
    if (zIndexValues.size > config.thresholds.zIndexMaxCardinality) {
      const values = [...zIndexValues.keys()].sort((a, b) => a - b);
      emit({
        ruleId: "design/zindex-ladder",
        message: `${zIndexValues.size} distinct z-index values in use: ${values.slice(0, 10).join(", ")}${values.length > 10 ? "…" : ""}`,
        file: project.frontendRoot,
      });
    }
    if (shadowSignatures.size > config.thresholds.shadowMaxCardinality) {
      emit({
        ruleId: "design/shadow-sprawl",
        message: `${shadowSignatures.size} distinct shadow definitions in use`,
        file: project.frontendRoot,
      });
    }
    for (const [file, info] of filesByMixedUnit) {
      const sample = info.lines[0]?.raw ?? "";
      emit({
        ruleId: "design/mixed-units",
        message: `Mixed px and rem in same file (${info.px} px, ${info.rem} rem)${sample ? `: ${sample}` : ""}`,
        file,
        line: info.lines[0]?.line,
      });
    }
    if (projectHasDarkVariants) {
      // Only emit unpaired-dark findings if the project ships dark mode. Otherwise
      // the rule is just noise on a light-only app.
      for (const [file, count] of filesByUnpairedDark) {
        emit({
          ruleId: "design/dark-mode-pairing",
          message: `${count} themed Tailwind classes (bg-*) without any paired dark: variant in this file`,
          file,
        });
      }
    }
  },
};

function locate(src: string, idx: number): { line: number } {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return { line };
}

function bump<K>(m: Map<K, number>, k: K) { m.set(k, (m.get(k) ?? 0) + 1); }
function bumpNum(m: Map<number, number>, k: number) { m.set(k, (m.get(k) ?? 0) + 1); }

function normalizeFamily(s: string): string {
  return s.replace(/['"!important]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

const WEIGHT_NAME_TO_NUMBER: Record<string, string> = {
  thin: "100", extralight: "200", light: "300", normal: "400", regular: "400",
  medium: "500", semibold: "600", bold: "700", extrabold: "800", black: "900",
};

function normalizeWeight(s: string): string {
  const lower = s.trim().toLowerCase();
  return WEIGHT_NAME_TO_NUMBER[lower] ?? lower.replace(/\s+/g, "");
}

function normalizeShadow(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function isOverlayOpacityLadder(raw: string): boolean {
  const lower = raw.toLowerCase().replace(/\s+/g, "");
  // rgba(0,0,0,*) and rgba(255,255,255,*) — overlay scrim conventions.
  return /^rgba\(0,0,0,/.test(lower) || /^rgba\(255,255,255,/.test(lower);
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item); else out.set(k, [item]);
  }
  return out;
}

interface ColorSample { color: RGB; raw: string; file: string; line: number; }

function clusterColors(samples: ColorSample[]): ColorSample[][] {
  // Bucket by hue (12 buckets of 30°). Within bucket, greedy merge with ΔE < 5.
  const HUE_BUCKETS = 12;
  const buckets: ColorSample[][] = Array.from({ length: HUE_BUCKETS }, () => []);
  for (const s of samples) {
    const h = colorHue(s.color);
    const bucket = Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
    buckets[bucket].push(s);
  }
  const out: ColorSample[][] = [];
  for (const bucket of buckets) {
    if (bucket.length < 2) continue;
    const used = new Array(bucket.length).fill(false);
    for (let i = 0; i < bucket.length; i++) {
      if (used[i]) continue;
      const cluster: ColorSample[] = [bucket[i]];
      used[i] = true;
      for (let j = i + 1; j < bucket.length; j++) {
        if (used[j]) continue;
        if (deltaE(bucket[i].color, bucket[j].color) < 5) {
          cluster.push(bucket[j]);
          used[j] = true;
        }
      }
      if (cluster.length > 0) out.push(cluster);
    }
  }
  return out;
}

function isShadcnBaseComponent(rel: string): boolean {
  // shadcn copies its base components into a single folder. Common conventions:
  // "components/ui/", "ui/", "@/components/ui/". Dark variants in those files
  // come from the library's defaults, not project intent.
  return /(?:^|\/)components\/ui\//.test(rel) || /(?:^|\/)ui\/[^/]+\.(?:tsx|jsx)$/.test(rel);
}

function cssCustomPropertiesPresent(project: ProjectInfo): boolean {
  // Cheap-ish heuristic: look for a globals.css or similar with --foo-color tokens.
  const candidateFiles = walk(project.frontendRoot, { extensions: STYLE_EXT, maxDepth: 4 });
  for (const file of candidateFiles.slice(0, 50)) {
    try {
      const src = readFileSync(file, "utf8");
      if (/--[a-z][\w-]*:\s*[#a-zA-Z\d.]/i.test(src)) return true;
    } catch {
      continue;
    }
  }
  return false;
}
