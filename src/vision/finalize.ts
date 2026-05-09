import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUB_DIMENSIONS } from "./rubric.js";

export const STATIC_CAP_WHEN_VISION = 70;
export const VISION_CONTRIBUTION = 30;

export interface VisionRouteScores {
  path: string;
  scores: Record<string, number>;
  evidence?: Record<string, string>;
}

export interface VisionFile {
  schemaVersion: number;
  baseUrl?: string;
  routes: VisionRouteScores[];
}

export interface FinalizeResult {
  staticScore: number;
  visionMean: number;            // 0-10 across all sub-dimensions, all routes
  visionContribution: number;    // 0-30
  finalScore: number;            // 0-100
  perDimensionMean: Record<string, number>;
  perRouteMean: Record<string, number>;
  weakestDimensions: { id: string; mean: number }[];
  strongestDimensions: { id: string; mean: number }[];
}

export interface FinalizeInputs {
  outDir: string; // .design-doctor/
}

export function finalize({ outDir }: FinalizeInputs): FinalizeResult {
  const resultPath = join(outDir, "result.json");
  const visionPath = join(outDir, "vision.json");
  if (!existsSync(resultPath)) {
    throw new Error(`No result.json found at ${resultPath}. Run \`design-doctor scan . --vision\` first.`);
  }
  if (!existsSync(visionPath)) {
    throw new Error(`No vision.json found at ${visionPath}. Fill in the template at vision.template.json and save it as vision.json.`);
  }
  const staticReport = JSON.parse(readFileSync(resultPath, "utf8")) as { score: number };
  const vision = JSON.parse(readFileSync(visionPath, "utf8")) as VisionFile;

  const subIds = SUB_DIMENSIONS.map((d) => d.id);
  const allScores: number[] = [];
  const perDim: Record<string, number[]> = Object.fromEntries(subIds.map((id) => [id, []]));
  const perRoute: Record<string, number[]> = {};

  for (const r of vision.routes ?? []) {
    perRoute[r.path] = perRoute[r.path] ?? [];
    for (const id of subIds) {
      const v = clamp(Number(r.scores?.[id] ?? 0), 0, 10);
      allScores.push(v);
      perDim[id].push(v);
      perRoute[r.path].push(v);
    }
  }

  const visionMean = mean(allScores);
  const visionContribution = (visionMean / 10) * VISION_CONTRIBUTION;
  const cappedStatic = Math.min(STATIC_CAP_WHEN_VISION, staticReport.score);
  const finalScore = Math.round(cappedStatic + visionContribution);

  const perDimensionMean = Object.fromEntries(subIds.map((id) => [id, round1(mean(perDim[id]))]));
  const perRouteMean = Object.fromEntries(Object.entries(perRoute).map(([k, v]) => [k, round1(mean(v))]));

  const ranked = Object.entries(perDimensionMean).sort((a, b) => a[1] - b[1]);
  const weakestDimensions = ranked.slice(0, 3).map(([id, mean]) => ({ id, mean }));
  const strongestDimensions = ranked.slice(-3).reverse().map(([id, mean]) => ({ id, mean }));

  return {
    staticScore: staticReport.score,
    visionMean: round1(visionMean),
    visionContribution: round1(visionContribution),
    finalScore,
    perDimensionMean,
    perRouteMean,
    weakestDimensions,
    strongestDimensions,
  };
}

export function writeFinalReport(outDir: string, finalRes: FinalizeResult): string {
  const finalPath = join(outDir, "final.json");
  writeFileSync(finalPath, JSON.stringify(finalRes, null, 2));
  return finalPath;
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
