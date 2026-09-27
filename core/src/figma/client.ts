// Minimal Figma REST client.
//
// Every response is cached on disk, keyed by URL. Tier 1 endpoints (file,
// nodes, images) allow only 10–30 requests per minute, and some plans far
// fewer per month, so a response we already have is never fetched again.
// Delete the cache directory to force a refresh.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FigmaNode, FileNodesResponse, FileResponse, NodeEntry } from "./types.ts";

const API = "https://api.figma.com";

export interface FigmaClientOptions {
  token: string;
  cacheDir: string;
  /** Called for every request that actually reaches Figma (not cache hits). */
  onRequest?: (url: string) => void;
}

export class FigmaClient {
  readonly #token: string;
  readonly #cacheDir: string;
  readonly #onRequest?: (url: string) => void;
  /** Requests sent to Figma by this client, excluding cache hits. */
  requestsSent = 0;
  /** When true, only cached responses are used and nothing is sent to Figma. */
  offline = false;

  constructor(options: FigmaClientOptions) {
    this.#token = options.token;
    this.#cacheDir = options.cacheDir;
    this.#onRequest = options.onRequest;
  }

  static fromEnv(cacheDir: string, onRequest?: (url: string) => void): FigmaClient {
    const token = process.env.FIGMA_TOKEN;
    if (!token) throw new Error("FIGMA_TOKEN is not set.");
    return new FigmaClient({ token, cacheDir, onRequest });
  }

  /** File metadata and the document tree down to `depth` (1 = pages only). */
  file(fileKey: string, depth: number): Promise<FileResponse> {
    return this.#get(`/v1/files/${fileKey}?depth=${depth}`);
  }

  /**
   * Full subtrees for the given node ids, plus the components and styles they use.
   * Each node is cached on its own, so only ids not yet cached are requested.
   * In offline mode, uncached ids come back as null.
   */
  async nodes(fileKey: string, ids: string[]): Promise<FileNodesResponse> {
    const dir = join(this.#cacheDir, fileKey, "nodes");
    const result: FileNodesResponse = { name: "", version: "", lastModified: "", nodes: {} };
    const missing: string[] = [];
    for (const id of ids) {
      const cached = await readJson<CachedNode>(join(dir, nodeFile(id)));
      if (cached) {
        result.nodes[id] = cached.entry;
        mergeFileInfo(result, cached);
      } else missing.push(id);
    }
    if (missing.length && !this.offline) {
      const list = [...missing].sort().map(encodeURIComponent).join(",");
      const res = await this.#fetch<FileNodesResponse>(`/v1/files/${fileKey}/nodes?ids=${list}`);
      await mkdir(dir, { recursive: true });
      for (const [id, entry] of Object.entries(res.nodes)) {
        const cached: CachedNode = { name: res.name, version: res.version, lastModified: res.lastModified, entry };
        if (entry) await writeFile(join(dir, nodeFile(id)), JSON.stringify(cached));
        result.nodes[id] = entry;
        mergeFileInfo(result, cached);
      }
    }
    for (const id of missing) result.nodes[id] ??= null;
    return result;
  }

  /**
   * Find a node inside any cached response (e.g. a variant inside a cached page), without
   * a request. Returns it with the component and style maps of the response it came from.
   */
  async findCached(fileKey: string, id: string): Promise<{ entry: NodeEntry; version: string } | undefined> {
    const dir = join(this.#cacheDir, fileKey, "nodes");
    const direct = await readJson<CachedNode>(join(dir, nodeFile(id)));
    if (direct?.entry) return { entry: direct.entry, version: direct.version };
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return undefined;
    }
    for (const f of files) {
      const cached = await readJson<CachedNode>(join(dir, f));
      if (!cached?.entry) continue;
      const found = findNode(cached.entry.document, id);
      if (found) return { entry: { ...cached.entry, document: found }, version: cached.version };
    }
    return undefined;
  }

  async #get<T>(path: string): Promise<T> {
    const cacheFile = join(this.#cacheDir, cacheName(path));
    const cached = await readJson<T>(cacheFile);
    if (cached) return cached;
    if (this.offline) throw new Error(`Offline and not cached: ${path}`);
    const body = await this.#fetch<T>(path);
    await mkdir(this.#cacheDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(body));
    return body;
  }

  async #fetch<T>(path: string): Promise<T> {
    const url = API + path;

    for (let attempt = 1; ; attempt++) {
      this.requestsSent++;
      this.#onRequest?.(url);
      const res = await fetch(url, { headers: { "X-Figma-Token": this.#token } });
      if (res.status === 429 && attempt < 4) {
        const wait = Number(res.headers.get("retry-after") ?? "60");
        const kind = res.headers.get("x-figma-rate-limit-type") ?? "unknown";
        // A very long wait means a monthly or daily budget is spent; retrying won't help.
        if (wait > 300) throw new RateLimitError(kind, wait, url);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`Figma ${res.status} ${res.statusText}: ${url}\n${await res.text()}`);
      return (await res.json()) as T;
    }
  }
}

/** Figma refused because a long-window budget (daily or monthly) is spent. */
export class RateLimitError extends Error {
  readonly limitType: string;
  readonly retryAfterSeconds: number;

  constructor(limitType: string, retryAfterSeconds: number, url: string) {
    const until = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
    super(`Figma API budget spent (rate limit type "${limitType}"); retry after ${until}. ${url}`);
    this.limitType = limitType;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface CachedNode {
  name: string;
  version: string;
  lastModified: string;
  entry: NodeEntry | null;
}

function mergeFileInfo(into: FileNodesResponse, from: CachedNode): void {
  into.name ||= from.name;
  into.lastModified ||= from.lastModified;
  // Nodes cached from different file versions are flagged, not silently mixed.
  if (!into.version) into.version = from.version;
  else if (into.version !== from.version && !into.version.split(",").includes(from.version)) into.version += `,${from.version}`;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

function findNode(node: FigmaNode, id: string): FigmaNode | undefined {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return undefined;
}

function nodeFile(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9]+/g, "-")}.json`;
}

function cacheName(path: string): string {
  const slug = path.replace(/^\/v1\//, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
  const hash = createHash("sha256").update(path).digest("hex").slice(0, 12);
  return `${slug}_${hash}.json`;
}
