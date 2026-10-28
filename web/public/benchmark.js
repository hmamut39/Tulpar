// The benchmark page: the latest recorded run of each case, from /api/benchmark.
import { initAccount } from "./account.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FRAMEWORKS = { react: "React", vue: "Vue", angular: "Angular", svelte: "Svelte", flutter: "Flutter", "web-components": "Web Components" };
const STATUS = { verified: ["pass", "Verified"], "unchecked-remain": ["skip", "No failures"], failed: ["fail", "Failed"] };
const CHECKS = { components: "Components", colors: "Colours", type: "Type", spacing: "Spacing", layout: "Layout", text: "Text", typeface: "Typeface", tests: "Tests", visual: "Pixels", states: "States", build: "Build", render: "Render" };
// Product names for known packages, as the generate page shows them.
const PRODUCTS = { "@carbon/react": "Carbon (IBM)", "@carbon/web-components": "Carbon (IBM)", "carbon-components-angular": "Carbon (IBM)", "carbon-components-svelte": "Carbon (IBM)", "@mui/material": "Material UI (MUI)", "@chakra-ui/react": "Chakra UI", "@radix-ui/themes": "Radix Themes", "@shoelace-style/shoelace": "Shoelace", primeng: "PrimeNG", "element-plus": "Element Plus" };
const product = (label) => {
  const [, name, version] = /^(.+)@([^@]+)$/.exec(label) ?? [label, label, ""];
  return `${PRODUCTS[name] ?? name}${version ? ` v${version}` : ""}`;
};
const STYLINGS = { css: "CSS", "css-modules": "CSS Modules", scss: "SCSS", less: "LESS", tailwind: "Tailwind CSS", "styled-components": "styled-components", emotion: "Emotion" };
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

async function main() {
  initAccount(await (await fetch("/api/config")).json()).catch(() => undefined);
  const { cases, updated } = await (await fetch("/api/benchmark")).json();
  if (!cases.length) return void ($("summary").textContent = "No benchmark results yet.");
  const clean = cases.filter((c) => c.status !== "failed").length;
  $("summary").textContent = `${clean} of ${cases.length} cases with no failing check · latest run ${day(updated)}`;
  $("cases").innerHTML = cases
    .map((c) => {
      const [cls, label] = STATUS[c.status] ?? ["skip", c.status];
      const failing = Object.entries(c.checks).filter(([, ok]) => !ok).map(([k]) => CHECKS[k] ?? k);
      const passing = Object.entries(c.checks).filter(([, ok]) => ok).length;
      return `<article class="bench-case">
  <div class="bench-head"><h3>${esc(FRAMEWORKS[c.adapter] ?? c.adapter)} · ${esc(product(c.designSystem))}</h3><span class="bench-status ${cls}">${label}</span></div>
  <p class="bench-meta">From a ${c.input === "figma" ? "Figma frame" : "screenshot"}${c.styling !== "default" ? ` · ${esc(STYLINGS[c.styling] ?? c.styling)}` : ""} · ${c.attempts} attempt${c.attempts === 1 ? "" : "s"} · ${Math.round(c.seconds)} s · ${esc(day(c.at))}</p>
  <p class="bench-checks">${passing} check${passing === 1 ? "" : "s"} passed${failing.length ? ` · <span class="bench-fail">failed: ${esc(failing.join(", "))}</span>` : ""}</p>
</article>`;
    })
    .join("");
}
main().catch(() => ($("summary").textContent = "The benchmark could not be loaded."));
