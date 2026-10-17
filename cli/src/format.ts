// Generated files are formatted the way the team formats code: Prettier with the project's own
// configuration (.prettierrc, package.json "prettier", .editorconfig) when it has one, Prettier's
// defaults when it does not. Formatting happens before verification, so what is checked is what ships.

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as prettier from "prettier";
import type { GeneratedFile } from "@tulpar/core";

type Plugin = prettier.Plugin | string | URL;

export async function formatFiles(dir: string, files: GeneratedFile[]): Promise<GeneratedFile[]> {
  return Promise.all(files.map(async (f) => ({ ...f, content: await formatFile(dir, f) })));
}

async function formatFile(dir: string, file: GeneratedFile): Promise<string> {
  const filepath = join(dir, file.path);
  try {
    const config = (await prettier.resolveConfig(filepath, { editorconfig: true })) ?? {};
    const plugins = [...(await projectPlugins(dir, config.plugins ?? [])), ...(file.path.endsWith(".svelte") ? await svelte() : [])];
    const info = await prettier.getFileInfo(filepath, { plugins: plugins as (string | prettier.Plugin)[] });
    if (!info.inferredParser) return file.content;
    return await prettier.format(file.content, { ...config, plugins, filepath });
  } catch {
    // Code Prettier cannot parse is left as written: the build reports what is wrong with it.
    return file.content;
  }
}

/** Plugins the project's Prettier config names (e.g. prettier-plugin-tailwindcss), found from the project; missing ones are skipped. */
async function projectPlugins(dir: string, names: Plugin[]): Promise<Plugin[]> {
  const require = createRequire(join(dir, "package.json"));
  const loaded: Plugin[] = [];
  for (const name of names) {
    if (typeof name !== "string") {
      loaded.push(name);
      continue;
    }
    try {
      loaded.push((await import(pathToFileURL(require.resolve(name)).href)) as prettier.Plugin);
    } catch {
      // not installed in the project: formatted without it
    }
  }
  return loaded;
}

let sveltePlugin: Promise<Plugin[]> | undefined;
function svelte(): Promise<Plugin[]> {
  sveltePlugin ??= import("prettier-plugin-svelte").then(
    (m) => [m as prettier.Plugin],
    () => [],
  );
  return sveltePlugin;
}
