// Tokens for projects styled with CSS: DTCG files exposed to code as CSS custom properties,
// and/or custom properties declared directly in the design system's stylesheets (css-tokens.ts).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readDtcg, type DtcgDocument, type TokenSet, type TokenValue } from "@tulpar/core";
import { readCssTokens, type CssTokenConfig } from "./css-tokens.ts";
import type { RuntimeTokenConfig } from "./runtime-tokens.ts";

export interface TokenConfig {
  /** DTCG token files. */
  files?: string[];
  /** Stylesheets that declare tokens as custom properties; used for tokens the DTCG files lack. */
  css?: CssTokenConfig;
  /** Tokens the library defines at runtime (PrimeNG, MUI, Chakra): read from a probe page. */
  runtime?: RuntimeTokenConfig;
  references?: string[];
  modesExtension?: string;
  modes?: string[];
  cssPrefix?: string;
}

export function readTokens(root: string, config: TokenConfig, cssDirs: string[], adapter: string): TokenSet {
  const gaps: string[] = [];
  const load = (file: string, referenceOnly: boolean): DtcgDocument[] => {
    const path = join(root, file);
    if (!existsSync(path)) {
      gaps.push(`Token file not found: ${file}`);
      return [];
    }
    return [{ label: file.replace(/^node_modules\//, ""), json: JSON.parse(readFileSync(path, "utf8")), referenceOnly }];
  };
  const docs = [...(config.files ?? []).flatMap((f) => load(f, false)), ...(config.references ?? []).flatMap((f) => load(f, true))];

  const prefix = config.cssPrefix ? `${config.cssPrefix}-` : "";
  const result = readDtcg(docs, {
    ...(config.modesExtension && { modesExtension: config.modesExtension }),
    ...(config.modes && { modes: config.modes }),
    codeRef: (name) => `var(--${prefix}${name})`,
    dimension: carbonLayoutDimension,
  });

  // Check each token's CSS custom property against the stylesheets the components ship.
  const used = cssCustomProperties(cssDirs);
  let unused = 0;
  for (const token of result.tokens) {
    token.codeRefConfirmed = used.has(`--${prefix}${token.name}`);
    if (!token.codeRefConfirmed) unused++;
  }
  if (unused) gaps.push(`${unused} of ${result.tokens.length} tokens' CSS custom properties are not used by any component stylesheet; their code names are unconfirmed.`);

  if (!config.css) return { adapter, modes: result.modes, tokens: result.tokens, gaps: [...result.gaps, ...gaps] };
  const css = readCssTokens(root, config.css);
  const known = new Set(result.tokens.map((t) => t.codeRef));
  const extra = css.tokens.filter((t) => !known.has(t.codeRef));
  return { adapter, modes: [...new Set([...result.modes, ...css.modes])], tokens: [...result.tokens, ...extra], gaps: [...result.gaps, ...gaps, ...css.gaps] };
}

/**
 * Carbon's layout tokens store bare numbers with a converter in `$extensions["carbon.layout"]`:
 * "miniUnits" means × 8 px (Carbon's mini unit); "rem" means the number is px, emitted as rem.
 */
function carbonLayoutDimension(raw: unknown, token: { node: Record<string, unknown> }): TokenValue | undefined {
  const ext = (token.node.$extensions as Record<string, { converter?: string }> | undefined)?.["carbon.layout"];
  if (typeof raw !== "number" || !ext?.converter) return undefined;
  if (ext.converter === "miniUnits") return { kind: "dimension", points: raw * 8 };
  if (ext.converter === "rem") return { kind: "dimension", points: raw };
  return { kind: "unresolved", text: String(raw), reason: `unknown carbon.layout converter "${ext.converter}"` };
}

function cssCustomProperties(packageDirs: string[]): Set<string> {
  const names = new Set<string>();
  for (const dir of packageDirs) {
    // Packages that ship ES modules keep their styles there; otherwise scan the whole directory.
    const base = existsSync(join(dir, "es")) ? join(dir, "es") : dir;
    if (!existsSync(base)) continue;
    for (const e of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.(css|scss)\.js$|\.css$/.test(e.name)) continue;
      for (const m of readFileSync(join(e.parentPath, e.name), "utf8").matchAll(/--[a-zA-Z0-9-]+/g)) names.add(m[0]);
    }
  }
  return names;
}

/** Tokens from a second source added to a set, skipping any whose code reference it already has. */
export function mergeTokens(base: TokenSet, extra: { tokens: TokenSet["tokens"]; modes: string[]; gaps: string[] }): TokenSet {
  const known = new Set(base.tokens.map((t) => t.codeRef));
  return {
    ...base,
    modes: [...new Set([...base.modes, ...extra.modes])],
    tokens: [...base.tokens, ...extra.tokens.filter((t) => !known.has(t.codeRef))],
    gaps: [...base.gaps, ...extra.gaps],
  };
}

/** The CSS custom property prefix of a project's tokens, from whichever source names one. */
export function tokenPrefix(config: TokenConfig | undefined): string {
  return config?.cssPrefix ?? config?.css?.prefix ?? config?.runtime?.prefix ?? "";
}
