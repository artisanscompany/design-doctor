// Lightweight JSX scanner. We avoid pulling in a full parser dependency; the
// rules we care about are surface-level enough that careful regex + line-aware
// extraction handles the common cases. When something needs true AST awareness
// we can swap in @babel/parser later — the call sites all go through these
// helpers so the upgrade is local.

export interface JsxElementHit {
  tag: string;
  open: string;          // "<Button variant=\"primary\">"
  attrs: Record<string, string | true>;
  text: string;          // immediate child text (one level deep, best-effort)
  line: number;
  column: number;
  selfClosing: boolean;
}

const ELEMENT_RE = /<([A-Za-z][A-Za-z0-9_.]*)\b([^>]*?)(\/?)>/g;
const ATTR_RE = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}))?/g;

export function findElements(src: string, tagFilter?: (t: string) => boolean): JsxElementHit[] {
  const hits: JsxElementHit[] = [];
  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(src))) {
    const [full, tag, attrStr, slash] = m;
    if (tagFilter && !tagFilter(tag)) continue;
    const { line, column } = positionAt(src, m.index);
    const attrs = parseAttrs(attrStr);
    const selfClosing = slash === "/";
    let text = "";
    if (!selfClosing) {
      const closeIdx = src.indexOf(`</${tag}`, m.index + full.length);
      if (closeIdx !== -1) {
        text = src.slice(m.index + full.length, closeIdx);
      }
    }
    hits.push({ tag, open: full, attrs, text, line, column, selfClosing });
  }
  return hits;
}

export function parseAttrs(s: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(s))) {
    const [, name, dq, sq, brace] = m;
    if (dq !== undefined) out[name] = dq;
    else if (sq !== undefined) out[name] = sq;
    else if (brace !== undefined) out[name] = `{${brace.trim()}}`;
    else out[name] = true;
  }
  return out;
}

export function positionAt(src: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (src.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline };
}

export function stripJsxExpressions(text: string): string {
  // Strip {…} expressions for prose-only inspection. Keeps surrounding whitespace.
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      depth++;
      continue;
    }
    if (c === "}") {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) out += c;
  }
  return out;
}

export function isUserFacingString(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 2) return false;
  if (/^[\d\W_]+$/.test(trimmed)) return false; // pure numbers/punctuation
  if (/^https?:\/\//.test(trimmed)) return false;
  if (/^[A-Z_][A-Z0-9_]+$/.test(trimmed)) return false; // CONSTANT_NAMES
  if (/^[a-z][a-zA-Z0-9]+$/.test(trimmed) && !trimmed.includes(" ")) return false; // single camelCase
  return /[A-Za-z]/.test(trimmed);
}

export function* iterText(src: string): Generator<{ text: string; index: number }> {
  // Walk the source pulling out JSX text fragments — the bits between > and < that
  // aren't inside attributes. Skips strings inside element openings.
  let inEl = false;
  let buf = "";
  let bufStart = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "<") {
      if (buf.trim()) yield { text: buf, index: bufStart };
      buf = "";
      inEl = true;
      continue;
    }
    if (c === ">") {
      inEl = false;
      bufStart = i + 1;
      buf = "";
      continue;
    }
    if (!inEl) buf += c;
  }
  if (buf.trim()) yield { text: buf, index: bufStart };
}
