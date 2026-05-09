import { execSync } from "node:child_process";

export function gitDiffFiles(root: string, base: string): string[] | null {
  try {
    const out = execSync(
      `git diff --name-only "${base}"...HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null; git diff --name-only 2>/dev/null`,
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const files = out.split("\n").map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set(files));
  } catch {
    return null;
  }
}
