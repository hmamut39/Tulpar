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
  /** Largest areas of difference, in design points relative to the frame, biggest first. */
  regions: Box[];
  /** The diff image, PNG base64 (differences in red over a faded render). */
  diffPng: string;
}

/**
 * Compare a render (PNG) with a baseline (PNG). The baseline is scaled to the render's size
 * first; `scale` is the render's pixels per design point, for reporting regions in points.
 */
export function compareImages(renderPng: Buffer, baselinePng: Buffer, scale = 1): VisualComparison {
  const render = PNG.sync.read(renderPng);
  let baseline: PNG = PNG.sync.read(baselinePng);
  if (baseline.width !== render.width || baseline.height !== render.height) baseline = resize(baseline, render.width, render.height);
  const { width, height } = render;
  const diff = new PNG({ width, height });
  const count = pixelmatch(render.data, baseline.data, diff.data, width, height, { threshold: 0.1, includeAA: false, alpha: 0.2 });
  return {
    mismatch: count / (width * height),
    width,
    height,
    regions: regions(diff, width, height).map((b) => ({ x: b.x / scale, y: b.y / scale, width: b.width / scale, height: b.height / scale })),
    diffPng: PNG.sync.write(diff).toString("base64"),
  };
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
