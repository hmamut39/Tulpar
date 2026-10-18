// Pixel comparison: the render against a baseline image of the design (a screenshot, or
// Figma's own image of the frame). Supporting evidence, never the only signal: text is
// rasterised differently everywhere, so anti-aliasing is ignored and a small share of
// differing pixels is tolerated. Where pixels differ is reported, not just how many.

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { Box } from "../model.ts";

export interface VisualComparison {
  /** Share of pixels that differ, 0–1. */
  mismatch: number;
  width: number;
  height: number;
  /**
   * Largest areas of difference, in design points relative to the frame, biggest first, with the
   * most common colour among the differing pixels on each side: something a repair can act on.
   */
  regions: (Box & { design?: string; render?: string; pixels: number; colorShare?: number })[];
  /** The diff image, PNG base64 (differences in red over a faded render). */
  diffPng: string;
}

/**
 * Compare a render (PNG) with a baseline (PNG). The baseline is scaled to the render's size
 * first; `scale` is the render's pixels per design point, for reporting regions in points.
 */
/**
 * `threshold` is pixelmatch's colour sensitivity: 0.1 for a render against a design; lower to see subtle
 * changes of one render against itself (Material's 8% state layers).
 */
export function compareImages(renderPng: Buffer, baselinePng: Buffer, scale = 1, threshold = 0.1): VisualComparison {
  const render = PNG.sync.read(renderPng);
  let baseline: PNG = PNG.sync.read(baselinePng);
  if (baseline.width !== render.width || baseline.height !== render.height) baseline = resize(baseline, render.width, render.height);
  const { width, height } = render;
  const diff = new PNG({ width, height });
  const count = pixelmatch(render.data, baseline.data, diff.data, width, height, { threshold, includeAA: false, alpha: 0.2 });
  return {
    mismatch: count / (width * height),
    width,
    height,
    regions: regions(diff, width, height).map((b) => ({
      x: b.x / scale,
      y: b.y / scale,
      width: b.width / scale,
      height: b.height / scale,
      ...dominantColors(b, diff, baseline, render),
      pixels: differing(b, diff),
    })),
    diffPng: PNG.sync.write(diff).toString("base64"),
  };
}

/** How many pixels differ inside a box (pixelmatch paints them pure red). */
function differing(box: Box, diff: PNG): number {
  let n = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * diff.width + x) * 4;
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) n++;
    }
  }
  return n;
}

/** Bilinear resize, enough to bring a 2× screenshot to a 1× render. */
function resize(src: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = Math.min(src.width - 1, (x + 0.5) * sx - 0.5);
      const fy = Math.min(src.height - 1, (y + 0.5) * sy - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const y0 = Math.max(0, Math.floor(fy));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const y1 = Math.min(src.height - 1, y0 + 1);
      const dx = fx - x0;
      const dy = fy - y0;
      for (let c = 0; c < 4; c++) {
        const p = (xx: number, yy: number) => src.data[(yy * src.width + xx) * 4 + c]!;
        const top = p(x0, y0) * (1 - dx) + p(x1, y0) * dx;
        const bottom = p(x0, y1) * (1 - dx) + p(x1, y1) * dx;
        out.data[(y * width + x) * 4 + c] = Math.round(top * (1 - dy) + bottom * dy);
      }
    }
  }
  return out;
}

/** The most common colour (to 5 bits per channel) among a region's differing pixels, per image. */
function dominantColors(box: Box, diff: PNG, design: PNG, render: PNG): { design?: string; render?: string; colorShare?: number } {
  const counts = [new Map<number, number[]>(), new Map<number, number[]>()];
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * diff.width + x) * 4;
      if (!(diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0)) continue;
      [design, render].forEach((img, side) => {
        const [r, g, b] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const acc = counts[side]!.get(key) ?? [0, 0, 0, 0];
        acc[0]! += 1;
        acc[1]! += r;
        acc[2]! += g;
        acc[3]! += b;
        counts[side]!.set(key, acc);
      });
    }
  }
  const hex = (m: Map<number, number[]>) => {
    const top = [...m.values()].sort((a, b) => b[0]! - a[0]!)[0];
    if (!top) return undefined;
    return `#${[top[1]!, top[2]!, top[3]!].map((v) => Math.round(v / top[0]!).toString(16).padStart(2, "0")).join("")}`;
  };
  const d = hex(counts[0]!);
  const r = hex(counts[1]!);
  // How much of the region's difference those two colours account for (the smaller side): near 1 when
  // the region is one colour drawn as another, low when shapes or text differ too.
  const share = (m: Map<number, number[]>) => {
    const all = [...m.values()].reduce((n, v) => n + v[0]!, 0);
    const top = Math.max(0, ...[...m.values()].map((v) => v[0]!));
    return all ? top / all : 0;
  };
  const colorShare = Math.min(share(counts[0]!), share(counts[1]!));
  return { ...(d && { design: d }), ...(r && { render: r }), ...(d && r && { colorShare: Math.round(colorShare * 100) / 100 }) };
}

/** Group differing pixels into coarse cells, join touching cells, return their bounding boxes. */
function regions(diff: PNG, width: number, height: number): Box[] {
  const cell = 8;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hot = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // pixelmatch paints differences pure red.
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) hot[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const boxes: (Box & { cells: number })[] = [];
  for (let start = 0; start < hot.length; start++) {
    if (!hot[start] || seen[start]) continue;
    let minX = cols, minY = rows, maxX = 0, maxY = 0, cells = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      cells++;
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (hot[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    boxes.push({ x: minX * cell, y: minY * cell, width: Math.min(width, (maxX + 1) * cell) - minX * cell, height: Math.min(height, (maxY + 1) * cell) - minY * cell, cells });
  }
  return boxes.sort((a, b) => b.cells - a.cells).slice(0, 5).map(({ cells: _c, ...b }) => b);
}

/**
 * A PNG (base64) laid onto an opaque background, white by default. Figma's pictures are transparent
 * where a frame has no fill of its own; compared as they are, those pixels read as black, so a section
 * without a background "differed" everywhere. What a person sees in Figma, and the render's page, is
 * white behind it.
 */
export function flatten(pngBase64: string, background: [number, number, number] = [255, 255, 255]): string {
  const img = PNG.sync.read(Buffer.from(pngBase64, "base64"));
  let transparent = false;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i]! < 255) {
      transparent = true;
      break;
    }
  }
  if (!transparent) return pngBase64;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]! / 255;
    for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(img.data[i + c]! * a + background[c]! * (1 - a));
    img.data[i + 3] = 255;
  }
  return PNG.sync.write(img).toString("base64");
}
