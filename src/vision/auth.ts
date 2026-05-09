import { existsSync, statSync } from "node:fs";

const AUTH_TTL_MS = 24 * 60 * 60 * 1000;

export interface AuthOptions {
  baseUrl: string;
  storageStateFile: string;     // .design-doctor/auth.json
  loginUrl?: string;             // env DESIGNDOCTOR_LOGIN_URL
  username?: string;             // env DESIGNDOCTOR_USER
  password?: string;             // env DESIGNDOCTOR_PASS
  usernameSelector?: string;     // default 'input[name="email" i], input[type="email"]'
  passwordSelector?: string;     // default 'input[type="password"]'
  submitSelector?: string;       // default 'button[type="submit"], input[type="submit"]'
  customLoginScript?: string;    // path to a JS file exporting async login(page, baseUrl)
}

export function readAuthOptionsFromEnv(baseUrl: string, storageStateFile: string): AuthOptions {
  return {
    baseUrl,
    storageStateFile,
    loginUrl: process.env.DESIGNDOCTOR_LOGIN_URL,
    username: process.env.DESIGNDOCTOR_USER,
    password: process.env.DESIGNDOCTOR_PASS,
    usernameSelector: process.env.DESIGNDOCTOR_USERNAME_SELECTOR,
    passwordSelector: process.env.DESIGNDOCTOR_PASSWORD_SELECTOR,
    submitSelector: process.env.DESIGNDOCTOR_SUBMIT_SELECTOR,
    customLoginScript: process.env.DESIGNDOCTOR_LOGIN_SCRIPT,
  };
}

export function authStateFresh(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const age = Date.now() - statSync(file).mtimeMs;
    return age < AUTH_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Performs login and writes a Playwright storageState file. No-op (and returns false)
 * if the user hasn't supplied credentials — the vision pass will run unauthenticated.
 */
export async function ensureAuth(opts: AuthOptions): Promise<boolean> {
  if (authStateFresh(opts.storageStateFile)) return true;
  if (opts.customLoginScript) {
    return runCustomLogin(opts);
  }
  if (!opts.loginUrl || !opts.username || !opts.password) return false;
  return runEnvLogin(opts);
}

async function runEnvLogin(opts: AuthOptions): Promise<boolean> {
  const playwright = await loadPlaywright();
  if (!playwright) throw new Error("Playwright is not installed. Run `npm i -D playwright` before using --vision with auth.");
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(opts.loginUrl!, { waitUntil: "networkidle" });
    const userSel = opts.usernameSelector ?? 'input[name="email" i], input[type="email"], input[name="username" i]';
    const passSel = opts.passwordSelector ?? 'input[type="password"]';
    const submitSel = opts.submitSelector ?? 'button[type="submit"], input[type="submit"]';
    await page.locator(userSel).first().fill(opts.username!);
    await page.locator(passSel).first().fill(opts.password!);
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.locator(submitSel).first().click(),
    ]);
    await context.storageState({ path: opts.storageStateFile });
    return true;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function runCustomLogin(opts: AuthOptions): Promise<boolean> {
  const playwright = await loadPlaywright();
  if (!playwright) throw new Error("Playwright is not installed.");
  const mod = await import(opts.customLoginScript!).catch((e) => {
    throw new Error(`Failed to load DESIGNDOCTOR_LOGIN_SCRIPT (${opts.customLoginScript}): ${e}`);
  });
  const fn = (mod as { login?: unknown; default?: unknown }).login ?? (mod as { default?: { login?: unknown } }).default;
  if (typeof fn !== "function") {
    throw new Error(`DESIGNDOCTOR_LOGIN_SCRIPT must export an async login(page, baseUrl) function`);
  }
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await fn(page, opts.baseUrl);
    await context.storageState({ path: opts.storageStateFile });
    return true;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function loadPlaywright(): Promise<typeof import("playwright") | null> {
  try {
    return (await import("playwright")) as typeof import("playwright");
  } catch {
    return null;
  }
}
