import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectInfo, UxDoctorConfig } from "../types.js";
import { discoverRoutes } from "./routes.js";
import { captureRoutes } from "./screenshot.js";
import { ensureAuth, readAuthOptionsFromEnv } from "./auth.js";
import { emitRubric } from "./rubric.js";
import { gradeHeadless } from "./judge.js";

export interface VisionOptions {
  baseUrl?: string;
  routesCap?: number;
  fullPage?: boolean;
  headless?: boolean;
  visionModel?: string;
}

export interface VisionRunResult {
  outDir: string;
  rubricPath: string;
  templatePath: string;
  capturedRoutes: number;
  failedRoutes: number;
  baseUrl: string;
  headless?: {
    visionJsonPath: string;
    costEstimate: number;
    modelUsed: string;
    failed: number;
  };
}

export async function runVisionPass(
  project: ProjectInfo,
  config: UxDoctorConfig,
  staticScore: number,
  visionOpts: VisionOptions,
): Promise<VisionRunResult> {
  const baseUrl = visionOpts.baseUrl ?? config.url ?? "http://localhost:3000";
  const outDir = join(project.root, ".design-doctor");
  const screenshotDir = join(outDir, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });

  const routes = discoverRoutes(project, config, { cap: visionOpts.routesCap ?? 10 });
  if (routes.length === 0) {
    throw new Error("No routes discovered. Add a `routes:` array to your design-doctor config.");
  }

  const authState = join(outDir, "auth.json");
  const authOpts = readAuthOptionsFromEnv(baseUrl, authState);
  await ensureAuth(authOpts);

  const records = await captureRoutes(routes, {
    baseUrl,
    outDir: screenshotDir,
    authStateFile: authOpts.storageStateFile,
    fullPage: visionOpts.fullPage ?? false,
  });

  const failed = records.filter((r) => !r.ok);

  const { rubricPath, templatePath } = emitRubric({
    outDir,
    baseUrl,
    records,
    staticScore,
  });

  let headless: VisionRunResult["headless"];
  if (visionOpts.headless) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("--vision --headless requires ANTHROPIC_API_KEY in your environment.");
    }
    const judge = await gradeHeadless({
      outDir,
      records,
      baseUrl,
      staticScore,
      apiKey,
      model: visionOpts.visionModel,
      maxRoutes: visionOpts.routesCap,
    });
    headless = {
      visionJsonPath: judge.visionJsonPath,
      costEstimate: judge.costEstimate,
      modelUsed: judge.modelUsed,
      failed: judge.failed,
    };
  }

  return {
    outDir,
    rubricPath,
    templatePath,
    capturedRoutes: records.filter((r) => r.ok).length,
    failedRoutes: failed.length,
    baseUrl,
    headless,
  };
}
