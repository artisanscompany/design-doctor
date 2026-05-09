import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

declare const __dirname: string;

const TARGET_DIRS = [
  "~/.claude/skills",
  "~/.agents/skills",
  "~/.cursor/skills",
  "~/.codeium/windsurf/skills",
  "~/.config/github-copilot/skills",
  "~/.config/opencode/skills",
];

export interface InstallOptions { dryRun?: boolean; yes?: boolean; }

export function install(opts: InstallOptions = {}): { dest: string; copied: boolean }[] {
  const skillSrc = resolve(__dirname, "..", "skills", "design-doctor");
  if (!existsSync(skillSrc)) {
    throw new Error(`Skill source not found at ${skillSrc}`);
  }
  const home = process.env.HOME || "";
  const out: { dest: string; copied: boolean }[] = [];
  for (const target of TARGET_DIRS) {
    const expanded = target.replace(/^~/, home);
    const parent = dirname(expanded);
    if (!existsSync(parent)) continue; // parent app dir not present — skip silently
    const dest = join(expanded, "design-doctor");
    if (opts.dryRun) {
      out.push({ dest, copied: false });
      continue;
    }
    mkdirSync(dest, { recursive: true });
    for (const file of readdirSync(skillSrc)) {
      copyFileSync(join(skillSrc, file), join(dest, file));
    }
    out.push({ dest, copied: true });
  }
  return out;
}
