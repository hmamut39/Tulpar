// Figma links → file key and node id.
// Accepts the forms Figma produces: /design/, /file/, /proto/, /board/ and branch links,
// with node-id written "12-34", "12:34" or "12%3A34".

export interface FigmaRef {
  fileKey: string;
  /** "12:34"; absent when the link points at the whole file. */
  nodeId?: string;
}

export function parseFigmaUrl(input: string): FigmaRef | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];
  if (!kind || !["design", "file", "proto", "board"].includes(kind) || !parts[1]) return undefined;
  // Branch links: /design/<file>/branch/<branch>/Name — the branch has its own key.
  const fileKey = parts[2] === "branch" && parts[3] ? parts[3] : parts[1];
  if (!/^[A-Za-z0-9]+$/.test(fileKey)) return undefined;
  const raw = url.searchParams.get("node-id");
  const m = raw ? /^(\d+)[-:](\d+)$/.exec(raw) : null;
  return { fileKey, ...(m && { nodeId: `${m[1]}:${m[2]}` }) };
}
