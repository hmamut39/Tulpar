// The safety check: a component made from a design draws the design. It has no reason to call the
// network, run code from a string, read cookies, storage or the environment, start a process, or write
// raw HTML. Code that does is either a mistake or what a prompt injection looks like: instructions planted
// in a Figma text layer, a library's docs or a file in the repo, which the model then followed. The
// sandbox contains such code while it is checked; this check keeps it from reaching the team.
//
// A scan of the source text in every language Tulpar writes, not a parse: each rule is a pattern for one
// API, so a match names the file, the line and what to do instead.

export interface SourceFile {
  path: string;
  content: string;
}

interface Rule {
  pattern: RegExp;
  what: string;
  instead: string;
}

const NETWORK = "takes its data as props or inputs; the app does the fetching";
const RULES: Rule[] = [
  // Network.
  { pattern: /\bfetch\s*\(/, what: "fetch() calls the network", instead: NETWORK },
  { pattern: /\bXMLHttpRequest\b/, what: "XMLHttpRequest calls the network", instead: NETWORK },
  { pattern: /\bnew\s+(?:WebSocket|EventSource)\b/, what: "opens a connection to a server", instead: NETWORK },
  { pattern: /\bsendBeacon\s*\(/, what: "sendBeacon() sends data to a server", instead: NETWORK },
  { pattern: /\baxios\b/, what: "axios calls the network", instead: NETWORK },
  { pattern: /\bHttpClient\b|\bHttpURLConnection\b|\bopenConnection\s*\(|\bWebClient\b|\bRestTemplate\b/, what: "an HTTP client calls the network", instead: NETWORK },
  { pattern: /\breqwest\b|\bgloo_net\b|\bgloo::net\b|\bio\.ktor\b|\bpackage:http\//, what: "an HTTP client calls the network", instead: NETWORK },
  // Code run from a string, and processes.
  { pattern: /(?<![\w.])eval\s*\(/, what: "eval() runs code from a string", instead: "write the code itself" },
  { pattern: /\bnew\s+Function\s*\(/, what: "new Function() runs code from a string", instead: "write the code itself" },
  { pattern: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/, what: "a timer given a string runs it as code", instead: "pass a function" },
  { pattern: /\bjavascript:/i, what: "a javascript: URL runs code", instead: "use an event handler" },
  { pattern: /\bRuntime\.getRuntime\s*\(\s*\)\s*\.exec\b|\bProcessBuilder\b|\bProcess\.Start\b|\bstd::process::Command\b|\bProcess\.(?:run|start)\s*\(/, what: "starts a process", instead: "a component never runs programs" },
  // Secrets, cookies and stored data.
  { pattern: /\bdocument\.cookie\b/, what: "reads or writes cookies", instead: "a component takes what it shows as props" },
  { pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/, what: "reads or writes the browser's stored data", instead: "keep state in the component, or take it as props" },
  { pattern: /\bprocess\.env\b|\bimport\.meta\.env\b|\bGetEnvironmentVariable\b|\bSystem\.getenv\b|\bstd::env::var\b|\bPlatform\.environment\b/, what: "reads environment variables, where secrets live", instead: "a component takes what it needs as props" },
  // Raw HTML: the way untrusted text becomes script.
  { pattern: /\bdangerouslySetInnerHTML\b/, what: "writes raw HTML", instead: "render the text as text" },
  { pattern: /\.(?:innerHTML|outerHTML)\s*\+?=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/, what: "writes raw HTML", instead: "render the text as text" },
  { pattern: /\bv-html\b|\[innerHTML\]|\{@html\b|\bbypassSecurityTrust\w*|\bunsafeHTML\b|\bMarkupString\b|\binner_html\b|\bnew\s+Html\s*\(/, what: "writes raw HTML", instead: "render the text as text" },
];

// Words before a URL that load it (rather than link to it or show it as text).
const LOADS = /(?:(?:\bsrc|\bsrcset|\burl\(|@import|<script|<link|<iframe|<embed|<object|\bImage\.network|\bNetworkImage|\bnew\s+Image\s*\(|\bImage\s*\(|\bAsyncImage\s*\(\s*model\s*=|\bsetSrc\s*\(|\bnew\s+URL\s*\(|\bposter|\bdata)\W{0,12}|\b(?:from|import)\s*\(?\s*["'`])$/i;
// Hosts a file names without loading anything: XML and SVG namespaces.
const NAMESPACES = /^(?:www\.w3\.org|schemas\.android\.com|schemas\.microsoft\.com|xmlns\.com)$/i;

export interface SafetyResult {
  /** One line per finding: "✗ path:line what: instead". */
  findings: string[];
  /** The same findings, for tools that place them on a line (editors, pull-request annotations). */
  items: { path: string; line: number; message: string }[];
  /** Hosts the code loads from the web. */
  hosts: string[];
}

/** Scans source files for what a design's component never needs. */
export function scanSafety(files: SourceFile[]): SafetyResult {
  const items: SafetyResult["items"] = [];
  const hosts = new Set<string>();
  for (const file of files) {
    const lines = withoutComments(file.content).split("\n");
    lines.forEach((line, i) => {
      const add = (message: string) => items.push({ path: file.path, line: i + 1, message });
      for (const rule of RULES) if (rule.pattern.test(line)) add(`${rule.what}: ${rule.instead}.`);
      for (const m of line.matchAll(/(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?[^\s"'`)<>]*/gi)) {
        const host = m[1]!;
        if (NAMESPACES.test(host) || (!m[0].startsWith("http") && !/[("'`=]\s*$/.test(line.slice(0, m.index)))) continue;
        if (!LOADS.test(line.slice(0, m.index))) continue;
        hosts.add(host);
        add(
          /font/i.test(host) || /@import|font/i.test(line)
            ? `loads fonts from ${host}: the app loads its own fonts (a third-party font request also tells that host who visits).`
            : `loads ${host} from the web: ship the asset with the code, or take its address as a prop the team sets.`,
        );
      }
    });
  }
  const unique = [...new Map(items.map((x) => [`${x.path}:${x.line} ${x.message}`, x])).values()];
  return { findings: unique.map((x) => `✗ ${x.path}:${x.line} ${x.message}`), items: unique, hosts: [...hosts] };
}

/**
 * Block comments, HTML comments and whole-line // comments become blank (lines are kept, so line numbers
 * hold). A // after code on the same line stays: it may be inside a string, such as a URL.
 */
function withoutComments(source: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^\s*\/\/.*$/gm, blank);
}
