import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredRoute } from "./routes.js";
import { routeSlug } from "./routes.js";

// Playwright is a peer dependency. We dynamic-import it so the core CLI stays
// lightweight; users who never run `--vision` never need it on disk.

export interface CaptureViewport {
  name: "desktop" | "mobile";
  width: number;
  height: number;
  isMobile: boolean;
}

export const VIEWPORTS: CaptureViewport[] = [
  { name: "desktop", width: 1280, height: 800, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

export interface CaptureOptions {
  baseUrl: string;
  outDir: string;            // .design-doctor/screenshots
  authStateFile?: string;     // optional storageState path
  viewports?: CaptureViewport[];
  fullPage?: boolean;
  maskSelectors?: string[];
  perRouteTimeoutMs?: number;
}

export interface CaptureRecord {
  path: string;
  viewport: CaptureViewport["name"];
  file: string;              // absolute
  ok: boolean;
  error?: string;
}

const ANIMATION_KILL_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`;

const DEFAULT_MASKS = [
  "time",
  "[data-design-doctor-mask]",
  "img[src*=\"avatar\"]",
  "img[src*=\"gravatar\"]",
  "[data-testid*=\"timestamp\"]",
];

export async function captureRoutes(
  routes: DiscoveredRoute[],
  options: CaptureOptions,
): Promise<CaptureRecord[]> {
  const playwright = await loadPlaywright();
  if (!playwright) {
    throw new Error(
      "Playwright is not installed. Run `npm i -D playwright` (or `playwright install chromium`) before using --vision.",
    );
  }

  mkdirSync(options.outDir, { recursive: true });
  const browser = await playwright.chromium.launch();
  const records: CaptureRecord[] = [];
  const masks = [...DEFAULT_MASKS, ...(options.maskSelectors ?? [])];
  const viewports = options.viewports ?? VIEWPORTS;
  const timeoutMs = options.perRouteTimeoutMs ?? 30_000;

  try {
    for (const viewport of viewports) {
      const contextOpts: Record<string, unknown> = {
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.isMobile ? 2 : 1,
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
      };
      if (options.authStateFile && existsSync(options.authStateFile)) {
        contextOpts.storageState = options.authStateFile;
      }
      const context = await browser.newContext(contextOpts);
      await context.addInitScript(() => {
        // Freeze Date / Math.random so two consecutive screenshots match.
        const FROZEN = new Date("2026-01-01T00:00:00Z").getTime();
        const OriginalDate = Date;
        // @ts-expect-error monkey-patch
        globalThis.Date = class extends OriginalDate {
          constructor(...args: unknown[]) {
            // @ts-expect-error spread to super
            super(...(args.length === 0 ? [FROZEN] : args));
          }
          static now() { return FROZEN; }
        };
        const ORIG_RANDOM = Math.random;
        let seed = 1;
        Math.random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      });
      // (page-level addStyleTag below also catches per-page navigation; context-level
      // addStyleTag is not part of the stable API.)

      for (const route of routes) {
        const slug = `${routeSlug(route.path)}.${viewport.name}.png`;
        const dest = join(options.outDir, slug);
        const url = options.baseUrl.replace(/\/$/, "") + concretePath(route);
        const page = await context.newPage();
        try {
          page.setDefaultTimeout(timeoutMs);
          await page.addStyleTag({ content: ANIMATION_KILL_CSS }).catch(() => {});
          await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
          for (const sel of masks) {
            await page.locator(sel).evaluateAll((els: Element[]) => {
              for (const el of els) (el as Element & { style: CSSStyleDeclaration }).style.visibility = "hidden";
            }).catch(() => {});
          }
          await page.waitForTimeout(150); // settle paints
          await page.screenshot({ path: dest, fullPage: options.fullPage ?? viewport.name === "desktop", animations: "disabled" });
          records.push({ path: route.path, viewport: viewport.name, file: dest, ok: true });
        } catch (e) {
          records.push({
            path: route.path,
            viewport: viewport.name,
            file: dest,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        } finally {
          await page.close().catch(() => {});
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // Drop a manifest so the agent / finalize step knows what landed.
  writeFileSync(join(options.outDir, "manifest.json"), JSON.stringify({ records }, null, 2));
  return records;
}

function concretePath(route: DiscoveredRoute): string {
  let path = route.path;
  // Substitute :params if the user provided samples; otherwise replace with "1" as a best-guess.
  path = path.replace(/:([\w-]+)/g, (_match, name: string) => {
    const sample = route.sampleParams?.[name];
    if (sample) return sample;
    if (/^id|.*Id$/.test(name)) return "1";
    return "1";
  });
  return path;
}

async function loadPlaywright(): Promise<typeof import("playwright") | null> {
  try {
    return (await import("playwright")) as typeof import("playwright");
  } catch {
    return null;
  }
}
