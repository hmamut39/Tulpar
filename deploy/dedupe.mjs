// Run when the image is built, in the same step that installs the example projects: each has its own copy of
// the same packages (Vite, TypeScript, Playwright…). Identical files become hard links to one copy, which
// counts once in the image layer; Fly unpacks at most 8 GiB. Nothing writes into node_modules at run time
// except new cache folders, so a shared file is never changed through one of its links.
// Run: node deploy/dedupe.mjs <dir> [<dir>…]
import { createHash } from "node:crypto";
import { linkSync, lstatSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const MIN_SIZE = 1024;
const first = new Map();
let saved = 0;
let linked = 0;

function visit(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) visit(path);
    else if (e.isFile()) file(path);
  }
}

function file(path) {
  const stat = lstatSync(path);
  if (stat.size < MIN_SIZE) return;
  // Mode too: a file and its executable twin must stay apart.
  const key = `${stat.size}:${stat.mode}:${createHash("sha1").update(readFileSync(path)).digest("hex")}`;
  const original = first.get(key);
  if (!original) return void first.set(key, path);
  if (lstatSync(original).ino === stat.ino) return;
  // Link first and swap, so a failure never leaves the file missing.
  const temp = `${path}.dedupe`;
  linkSync(original, temp);
  try {
    renameSync(temp, path);
  } catch (err) {
    unlinkSync(temp);
    throw err;
  }
  saved += stat.size;
  linked++;
}

for (const dir of process.argv.slice(2)) visit(dir);
console.log(`dedupe: ${linked} files linked, ${(saved / 1024 ** 3).toFixed(2)} GiB saved`);
