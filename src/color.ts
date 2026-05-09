// Color parsing + CIEDE2000 distance, just enough to cluster near-duplicate
// colors. We don't need a full color library — only "are these two close
// enough that a human reading the design would call them the same?"

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function parseColor(s: string): RGB | null {
  s = s.trim();
  if (s.startsWith("#")) return parseHex(s);
  if (s.startsWith("rgb")) return parseRgb(s);
  if (s.startsWith("hsl")) return parseHsl(s);
  return null;
}

function parseHex(s: string): RGB | null {
  const h = s.replace(/^#/, "");
  if (h.length === 3 || h.length === 4) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  return null;
}

function parseRgb(s: string): RGB | null {
  const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!m) return null;
  return {
    r: clamp(Math.round(parseFloat(m[1])), 0, 255),
    g: clamp(Math.round(parseFloat(m[2])), 0, 255),
    b: clamp(Math.round(parseFloat(m[3])), 0, 255),
  };
}

function parseHsl(s: string): RGB | null {
  const m = s.match(/hsla?\(\s*([\d.]+)\s*,?\s*([\d.]+)%?\s*,?\s*([\d.]+)%?/i);
  if (!m) return null;
  const h = parseFloat(m[1]) % 360;
  const sat = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  return hslToRgb(h, sat, l);
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp < 6) [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// CIEDE2000 — slightly heavy but the only widely-cited "perceptual distance"
// formula. ~5 means "noticeably different to a designer", ~2.3 is JND.
export function deltaE(a: RGB, b: RGB): number {
  const labA = rgbToLab(a);
  const labB = rgbToLab(b);
  return ciede2000(labA, labB);
}

interface Lab { L: number; a: number; b: number; }

function rgbToLab(c: RGB): Lab {
  let r = srgbToLinear(c.r / 255);
  let g = srgbToLinear(c.g / 255);
  let b = srgbToLinear(c.b / 255);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) / 1.00000;
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function ciede2000(la: Lab, lb: Lab): number {
  const kL = 1, kC = 1, kH = 1;
  const dL = lb.L - la.L;
  const Lb = (la.L + lb.L) / 2;
  const Ca = Math.hypot(la.a, la.b);
  const Cb = Math.hypot(lb.a, lb.b);
  const Cb2 = (Ca + Cb) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb2 ** 7 / (Cb2 ** 7 + 25 ** 7)));
  const a1p = la.a * (1 + G);
  const a2p = lb.a * (1 + G);
  const C1p = Math.hypot(a1p, la.b);
  const C2p = Math.hypot(a2p, lb.b);
  const Cbp = (C1p + C2p) / 2;
  const dCp = C2p - C1p;
  const h1p = atan2deg(la.b, a1p);
  const h2p = atan2deg(lb.b, a2p);
  let dhp = h2p - h1p;
  if (Math.abs(dhp) > 180) dhp += dhp > 0 ? -360 : 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp / 2));
  const Hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos(deg2rad(Hbp - 30))
              + 0.24 * Math.cos(deg2rad(2 * Hbp))
              + 0.32 * Math.cos(deg2rad(3 * Hbp + 6))
              - 0.20 * Math.cos(deg2rad(4 * Hbp - 63));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
              * Math.sin(deg2rad(60 * Math.exp(-(((Hbp - 275) / 25) ** 2))));
  return Math.sqrt(
    (dL / (kL * SL)) ** 2 +
    (dCp / (kC * SC)) ** 2 +
    (dHp / (kH * SH)) ** 2 +
    RT * (dCp / (kC * SC)) * (dHp / (kH * SH)),
  );
}

const deg2rad = (d: number) => (d * Math.PI) / 180;
const atan2deg = (y: number, x: number) => {
  let d = Math.atan2(y, x) * 180 / Math.PI;
  if (d < 0) d += 360;
  return d;
};

export function colorHue(c: RGB): number {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}
