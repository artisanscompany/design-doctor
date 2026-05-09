import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaptureRecord } from "./screenshot.js";
import { SUB_DIMENSIONS } from "./rubric.js";

// Headless vision pass: send screenshots + rubric to Claude API, parse JSON,
// write vision.json. The Anthropic SDK is a peer dependency so users who never
// run --vision --headless never need it on disk.

export interface JudgeOptions {
  outDir: string;
  records: CaptureRecord[];
  baseUrl: string;
  staticScore: number;
  apiKey: string;
  model?: string;          // default claude-sonnet-4-6
  maxRoutes?: number;
}

export interface JudgeResult {
  visionJsonPath: string;
  costEstimate: number;     // USD
  modelUsed: string;
  routesGraded: number;
  failed: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

export async function gradeHeadless(opts: JudgeOptions): Promise<JudgeResult> {
  const sdk = await loadAnthropic();
  if (!sdk) {
    throw new Error("`@anthropic-ai/sdk` is not installed. Run `npm i -D @anthropic-ai/sdk` before --vision --headless.");
  }
  const client = new sdk.Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? DEFAULT_MODEL;

  // Group screenshot records by route (we send desktop + mobile together for context).
  const routeMap = new Map<string, CaptureRecord[]>();
  for (const r of opts.records) {
    if (!r.ok) continue;
    const list = routeMap.get(r.path) ?? [];
    list.push(r);
    routeMap.set(r.path, list);
  }

  const routesToGrade = Array.from(routeMap.keys()).slice(0, opts.maxRoutes ?? 10);
  const out = {
    schemaVersion: 1,
    baseUrl: opts.baseUrl,
    routes: [] as Array<{
      path: string;
      screenshots: { desktop?: string; mobile?: string };
      scores: Record<string, number>;
      evidence: Record<string, string>;
    }>,
  };

  let costTokens = 0;
  let failed = 0;

  for (const path of routesToGrade) {
    const captures = routeMap.get(path)!;
    const desktop = captures.find((r) => r.viewport === "desktop");
    const mobile = captures.find((r) => r.viewport === "mobile");

    try {
      const message = await client.messages.create({
        model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: buildContent(path, desktop, mobile) as never,
        }],
      });

      const text = extractText(message);
      const parsed = parseJsonScores(text);
      out.routes.push({
        path,
        screenshots: {
          desktop: desktop?.file,
          mobile: mobile?.file,
        },
        scores: parsed.scores,
        evidence: parsed.evidence,
      });
      costTokens += message.usage?.input_tokens ?? 0;
      costTokens += (message.usage?.output_tokens ?? 0) * 5; // output is 5x input
    } catch (e) {
      failed++;
      // emit a stub so finalize still works (zeros will pull score down — that's
      // honest behavior when grading fails)
      out.routes.push({
        path,
        screenshots: { desktop: desktop?.file, mobile: mobile?.file },
        scores: Object.fromEntries(SUB_DIMENSIONS.map((d) => [d.id, 0])),
        evidence: Object.fromEntries(SUB_DIMENSIONS.map((d) => [d.id, `failed: ${e instanceof Error ? e.message : String(e)}`])),
      });
    }
  }

  const visionJsonPath = join(opts.outDir, "vision.json");
  writeFileSync(visionJsonPath, JSON.stringify(out, null, 2));

  // Rough cost: Sonnet 4.6 is $3/M input, $15/M output. We've already weighted
  // output 5x in costTokens above, so divide accordingly.
  const costEstimate = (costTokens / 1_000_000) * 3;

  return { visionJsonPath, costEstimate, modelUsed: model, routesGraded: routesToGrade.length, failed };
}

const SYSTEM_PROMPT = `You are a senior UX/UI design reviewer grading a single route of a web app against a 10-dimension rubric.

For every dimension, return a JSON object of the shape:
{
  "scores": { "<dimension_id>": 0-10, ... },
  "evidence": { "<dimension_id>": "one short sentence quoting a specific element", ... }
}

Rubric (each scored 0–10):
${SUB_DIMENSIONS.map((d) => `- ${d.id} — ${d.label}: ${d.description}`).join("\n")}

Anchors:
- 9–10: clear, hierarchy works at a glance, polished, mobile reflows cleanly
- 5–7: decent but with rough edges
- 0–4: hierarchy unclear, spacing inconsistent, copy generic, cramped
Return ONLY the JSON object, no prose. Defer to axe-core for exact contrast ratios; judge whether the impression is legible.`;

function buildContent(path: string, desktop?: CaptureRecord, mobile?: CaptureRecord): Array<{ type: string; [k: string]: unknown }> {
  const blocks: Array<{ type: string; [k: string]: unknown }> = [
    { type: "text", text: `Route: ${path}\nGrade desktop + mobile screenshots together.` },
  ];
  if (desktop?.ok) blocks.push(imageBlock(desktop.file, "desktop"));
  if (mobile?.ok) blocks.push(imageBlock(mobile.file, "mobile"));
  blocks.push({ type: "text", text: "Return JSON only." });
  return blocks;
}

function imageBlock(filePath: string, label: string): { type: string; [k: string]: unknown } {
  const data = readFileSync(filePath).toString("base64");
  return {
    type: "image",
    source: { type: "base64", media_type: "image/png", data },
  };
}

function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

function parseJsonScores(text: string): { scores: Record<string, number>; evidence: Record<string, string> } {
  // Pull out the first {...} block. If parsing fails, return zeros so
  // finalize() can still run rather than crashing the whole pass.
  const match = text.match(/\{[\s\S]*\}/);
  const empty = {
    scores: Object.fromEntries(SUB_DIMENSIONS.map((d) => [d.id, 0])),
    evidence: Object.fromEntries(SUB_DIMENSIONS.map((d) => [d.id, "(failed to parse)"])),
  };
  if (!match) return empty;
  try {
    const parsed = JSON.parse(match[0]) as { scores?: Record<string, number>; evidence?: Record<string, string> };
    return {
      scores: { ...empty.scores, ...(parsed.scores ?? {}) },
      evidence: { ...empty.evidence, ...(parsed.evidence ?? {}) },
    };
  } catch {
    return empty;
  }
}

// Loader returns `any` on purpose — the SDK is an optional peer dep, and the
// dual-mode (CommonJS/ESM) typings differ by import resolution. We don't want
// build-time pinning of the SDK shape; we only call `.messages.create`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAnthropic(): Promise<any> {
  try {
    return await import("@anthropic-ai/sdk");
  } catch {
    return null;
  }
}
