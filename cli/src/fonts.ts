// The design's typefaces, for the render. The sandbox that renders generated code has no network, so a
// font the code loads from Google Fonts (Newsreader on a grocery page) never arrives and a fallback
// draws the text: the typeface check fails and every text box is a little off. Tulpar fetches the
// design's families from Fontsource (open-licensed fonts, the same files Google Fonts serves), caches
// them, and hands them to the render as @font-face rules with the files inlined.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesignNode } from "@tulpar/core";

const API = "https://api.fontsource.org/v1/fonts/";
const CACHE = process.env.TULPAR_FONT_CACHE ?? join(tmpdir(), "tulpar-fonts");
// Families the render already has (shipped with Tulpar) or every browser has: nothing to fetch.
const HAVE = new Set(["ibm plex sans", "ibm plex mono", "roboto", "inter", "open sans", "arial", "helvetica", "times new roman", "georgia", "courier new", "sf pro", "sf pro text", "sf pro display", "segoe ui"]);

/** Every family the design's text uses. */
export function designFamilies(root: DesignNode): string[] {
  const out = new Set<string>();
  const visit = (n: DesignNode) => {
    if (!n.visible) return;
    if (n.kind === "text" && n.style.fontFamily) out.add(n.style.fontFamily);
    if ("children" in n) for (const c of n.children) visit(c);
  };
  visit(root);
  return [...out];
}

/** Family → the weights and styles the design's text uses. */
export function designFonts(root: DesignNode): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const visit = (n: DesignNode) => {
    if (!n.visible) return;
    if (n.kind === "text" && n.style.fontFamily && !HAVE.has(n.style.fontFamily.toLowerCase())) {
      const set = out.get(n.style.fontFamily) ?? new Set<string>();
      set.add(`${n.style.fontWeight ?? 400}-${n.style.italic ? "italic" : "normal"}`);
      out.set(n.style.fontFamily, set);
    }
    if ("children" in n) for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

interface FontsourceFont {
  family: string;
  weights: number[];
  styles: string[];
  defSubset: string;
  variable?: boolean;
  variants: Record<string, Record<string, Record<string, { url: { woff2?: string } }>>>;
}

/** @font-face rules for the design's families that Fontsource has, files inlined; "" when none. Never throws. */
export async function designFontFaces(root: DesignNode): Promise<string> {
  const rules: string[] = [];
  for (const [family, variants] of designFonts(root)) {
    try {
      const id = family.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const meta = await cached(`${id}.json`, async () => {
        const res = await fetch(API + id, { signal: AbortSignal.timeout(8000) });
        return res.ok ? Buffer.from(await res.text()) : undefined;
      });
      if (!meta) continue;
      const font = JSON.parse(meta.toString("utf8")) as FontsourceFont;
      // A variable font, as Figma draws it: one file for every weight, and its optical size (opsz) follows
      // the text size. A static file is cut at one optical size, and draws large headings at another width.
      if (font.variable) {
        const styles = new Set([...variants].map((v) => v.split("-")[1]!).filter((s) => font.styles.includes(s)));
        let any = false;
        for (const style of styles) {
          const file = await cached(`${id}-vf-${style}.woff2`, async () => {
            const res = await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/${id}:vf@latest/${font.defSubset}-standard-${style}.woff2`, { signal: AbortSignal.timeout(15000) });
            return res.ok ? Buffer.from(await res.arrayBuffer()) : undefined;
          });
          if (!file) continue;
          any = true;
          rules.push(`@font-face { font-family: ${JSON.stringify(font.family)}; font-style: ${style}; font-weight: ${Math.min(...font.weights)} ${Math.max(...font.weights)}; font-display: block; src: url(data:font/woff2;base64,${file.toString("base64")}) format("woff2"); }`);
        }
        if (any) continue;
      }
      for (const v of variants) {
        const [w, style] = v.split("-") as [string, "normal" | "italic"];
        const weight = font.weights.reduce((best, x) => (Math.abs(x - Number(w)) < Math.abs(best - Number(w)) ? x : best), font.weights[0]!);
        const s = font.styles.includes(style) ? style : "normal";
        const url = font.variants[String(weight)]?.[s]?.[font.defSubset]?.url.woff2;
        if (!url || !/^https:\/\/cdn\.jsdelivr\.net\/fontsource\//.test(url)) continue;
        const file = await cached(`${id}-${weight}-${s}.woff2`, async () => {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          return res.ok ? Buffer.from(await res.arrayBuffer()) : undefined;
        });
        if (!file) continue;
        // Declared at the weight the design asks for, so the text uses it even when the nearest file differs.
        rules.push(`@font-face { font-family: ${JSON.stringify(font.family)}; font-style: ${style}; font-weight: ${w}; font-display: block; src: url(data:font/woff2;base64,${file.toString("base64")}) format("woff2"); }`);
      }
    } catch {
      // A font that cannot be fetched leaves the fallback, and the typeface check says so.
    }
  }
  return rules.join("\n");
}

async function cached(name: string, fetchIt: () => Promise<Buffer | undefined>): Promise<Buffer | undefined> {
  const path = join(CACHE, name);
  if (existsSync(path)) return readFile(path);
  const data = await fetchIt();
  if (!data) return undefined;
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, data);
  return data;
}
