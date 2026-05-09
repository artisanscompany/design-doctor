import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureRecord } from "./screenshot.js";

export interface SubDimension {
  id: string;
  label: string;
  description: string;
  badExample: string;
  goodExample: string;
}

export const SUB_DIMENSIONS: SubDimension[] = [
  {
    id: "visual_hierarchy",
    label: "Visual hierarchy",
    description: "Is it obvious what the page is about and what to do next? H1 prominent, primary CTA stands out, secondary content visually demoted.",
    badExample: "Five elements compete for attention; primary CTA same weight as everything else.",
    goodExample: "Single dominant headline + single visible primary action; supporting content visually quieter.",
  },
  {
    id: "spacing_alignment",
    label: "Spacing & alignment",
    description: "Spacing follows a clear scale (4/8px grid). Elements align to columns. Padding inside groups is tighter than padding between groups.",
    badExample: "Cards have inconsistent padding, fields drift left/right, gaps between sections vary randomly.",
    goodExample: "Everything snaps to a grid; group-internal spacing < group-external spacing.",
  },
  {
    id: "typography",
    label: "Typography",
    description: "Type scale uses 3–5 sizes. Body text ≥16px on mobile. Line-height generous on body copy. ≤3 weights, ≤2 families.",
    badExample: "Six font sizes used arbitrarily, body copy tight (1.2 line-height), four font weights.",
    goodExample: "Clear scale; body 16/24, headings step up cleanly; ≤3 weights total.",
  },
  {
    id: "color_contrast",
    label: "Color & contrast",
    description: "Foreground text passes 4.5:1; primary action visibly contrasts surrounds; non-text UI (icons, borders) ≥3:1. Defer to axe for exact ratios; judge here whether the impression is legible.",
    badExample: "Light gray on white body copy; primary button color same family as background.",
    goodExample: "Body comfortably legible; CTA pops against neighbors.",
  },
  {
    id: "affordance_clarity",
    label: "Affordance clarity",
    description: "Buttons look pressable, links look followable, disabled looks disabled. Hover/focus states visible.",
    badExample: "Buttons indistinguishable from cards; links neither colored nor underlined.",
    goodExample: "Interactive elements are obviously interactive; disabled states are visibly muted.",
  },
  {
    id: "information_density",
    label: "Information density",
    description: "Page conveys necessary info without overwhelming. Whitespace lets content breathe. Below-fold has structure too.",
    badExample: "Wall of text; cards crammed edge-to-edge with no breathing room.",
    goodExample: "Content chunked into scannable sections with deliberate empty space.",
  },
  {
    id: "consistency",
    label: "Consistency",
    description: "Same component is styled the same way wherever it appears. Buttons, cards, badges share visual language.",
    badExample: "Two button styles for the same action; cards have different shadows in different sections.",
    goodExample: "Unified component library is visible — the same widget reads the same everywhere.",
  },
  {
    id: "state_quality",
    label: "Empty/error/loading state quality",
    description: "When data is empty, missing, or loading, the page communicates clearly. Skeletons or spinners on async; explanatory empty states with next-step CTAs.",
    badExample: "Blank panel when there's no data; stuck spinner with no fallback; error renders raw stack trace.",
    goodExample: "Empty state has illustration/copy/CTA; loading shows skeleton; error explains and offers recovery.",
  },
  {
    id: "mobile_adaptation",
    label: "Mobile adaptation",
    description: "Mobile screenshot reads well at 390px wide. Targets are reachable; text isn't clipped; nav adapts.",
    badExample: "Horizontal scroll on mobile, tiny tap targets, text clipped behind chrome.",
    goodExample: "Layout reflows cleanly to single column; targets ≥44px; no horizontal scroll.",
  },
  {
    id: "brand_coherence",
    label: "Brand coherence",
    description: "Visual language feels intentional and unified rather than assembled from disparate templates.",
    badExample: "Each section looks like it came from a different design system.",
    goodExample: "One unified voice across the page — color, type, spacing, illustration style all align.",
  },
];

export interface EmitRubricOptions {
  outDir: string;          // .design-doctor/
  baseUrl: string;
  records: CaptureRecord[];
  staticScore: number;
}

export function emitRubric(opts: EmitRubricOptions): { rubricPath: string; templatePath: string } {
  const rubricPath = join(opts.outDir, "rubric.md");
  const templatePath = join(opts.outDir, "vision.template.json");

  // Markdown rubric for the agent to read alongside the screenshots.
  const md: string[] = [];
  md.push(`# design-doctor vision rubric`);
  md.push("");
  md.push(`Static score so far: **${opts.staticScore}/100** (capped at 70 once vision pass is folded in).`);
  md.push("");
  md.push(`Look at every screenshot under \`screenshots/\` and grade each one against the rubric below. Write your scores to \`vision.json\` (use \`vision.template.json\` as a starting point), then run:`);
  md.push("");
  md.push("```bash");
  md.push("npx -y design-doctor finalize");
  md.push("```");
  md.push("");
  md.push(`## Rubric (10 sub-dimensions, each 0–10)`);
  md.push("");
  for (const d of SUB_DIMENSIONS) {
    md.push(`### ${d.label} \`${d.id}\``);
    md.push(d.description);
    md.push(`- **9–10:** ${d.goodExample}`);
    md.push(`- **2–4:** ${d.badExample}`);
    md.push("");
  }

  md.push(`## Captured routes`);
  md.push("");
  for (const r of dedup(opts.records.map((x) => x.path))) {
    md.push(`### ${r}`);
    const desktop = opts.records.find((x) => x.path === r && x.viewport === "desktop");
    const mobile = opts.records.find((x) => x.path === r && x.viewport === "mobile");
    if (desktop?.ok) md.push(`- Desktop: \`${rel(desktop.file, opts.outDir)}\``);
    else if (desktop) md.push(`- Desktop: failed (${desktop.error ?? "unknown"})`);
    if (mobile?.ok) md.push(`- Mobile: \`${rel(mobile.file, opts.outDir)}\``);
    else if (mobile) md.push(`- Mobile: failed (${mobile.error ?? "unknown"})`);
    md.push("");
  }
  md.push(`## How to score`);
  md.push("");
  md.push(`- Score each sub-dimension 0–10. Anchor against the bad/good examples.`);
  md.push(`- For each score, include a short evidence quote naming the specific element you saw.`);
  md.push(`- Don't grade contrast precisely — defer to axe-core for exact ratios. Judge whether the impression is legible.`);
  md.push(`- Score what you actually see, not what you assume the rest of the app might look like.`);
  md.push("");

  writeFileSync(rubricPath, md.join("\n"));

  // JSON template the agent fills in.
  const template = {
    schemaVersion: 1,
    baseUrl: opts.baseUrl,
    routes: dedup(opts.records.map((x) => x.path)).map((p) => ({
      path: p,
      screenshots: {
        desktop: rel(opts.records.find((x) => x.path === p && x.viewport === "desktop")?.file ?? "", opts.outDir) || null,
        mobile: rel(opts.records.find((x) => x.path === p && x.viewport === "mobile")?.file ?? "", opts.outDir) || null,
      },
      scores: Object.fromEntries(SUB_DIMENSIONS.map((d) => [d.id, 0])),
      evidence: Object.fromEntries(SUB_DIMENSIONS.map((d) => [d.id, ""])),
    })),
  };
  writeFileSync(templatePath, JSON.stringify(template, null, 2));

  return { rubricPath, templatePath };
}

function dedup<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function rel(p: string, root: string): string {
  if (!p) return "";
  return p.startsWith(root) ? p.slice(root.length).replace(/^\//, "") : p;
}
