// A project: a directory with a tulpar.json, and the adapter it names.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AdapterHost, type ProjectParams } from "@tulpar/core";

export interface Project {
  root: string;
  config: { adapter: string; figma?: { fileKey?: string }; [section: string]: unknown };
  params: ProjectParams;
}

export async function loadProject(dir: string): Promise<Project> {
  const root = resolve(dir);
  const config = JSON.parse(await readFile(join(root, "tulpar.json"), "utf8"));
  return { root, config, params: { root, config: (config[config.adapter] as Record<string, unknown>) ?? {} } };
}

/** Start the project's adapter. Adapters are separate programs; the core only talks to them over stdio. */
export function startAdapter(project: Project): Promise<AdapterHost> {
  const main = resolve(import.meta.dirname, "../../adapters", project.config.adapter, "src/main.ts");
  return AdapterHost.start(process.execPath, [main]);
}

export async function withAdapter<T>(project: Project, fn: (host: AdapterHost) => Promise<T>): Promise<T> {
  const host = await startAdapter(project);
  try {
    return await fn(host);
  } finally {
    await host.stop();
  }
}
