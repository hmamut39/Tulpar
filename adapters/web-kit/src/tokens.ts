// Tokens for projects styled with CSS: DTCG files, exposed to code as CSS custom properties.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readDtcg, type DtcgDocument, type TokenSet, type TokenValue } from "@tulpar/core";

export interface TokenConfig {
  files: string[];
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
  const docs = [...config.files.flatMap((f) => load(f, false)), ...(config.references ?? []).flatMap((f) => load(f, true))];

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

  return { adapter, modes: result.modes, tokens: result.tokens, gaps: [...result.gaps, ...gaps] };
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
