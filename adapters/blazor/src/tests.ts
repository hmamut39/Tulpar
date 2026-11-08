// A generated Blazor component's tests (bUnit with xUnit), run on the .NET runner (deploy/dotnet-runner.ts): bUnit
// renders in .NET's memory, not in a browser, so the generated code runs there, never on the main server. The runner
// holds a test project, restored when its image was built; a check copies the component and its test into it and
// runs dotnet test offline, as an unprivileged user with the network blocked.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestRunResult } from "@tulpar/core";

export const RUNNER = "bUnit with xUnit (.NET)";

/** The test project's packages: bUnit and xUnit, and the design system's at the project's own versions. */
export const TEST_PACKAGES: Record<string, string> = {
  bunit: "2.14.0",
  "xunit.v3": "3.2.1",
  "xunit.runner.visualstudio": "3.1.5",
  "Microsoft.NET.Test.Sdk": "18.0.1",
};

/** The design system's PackageReferences in a .csproj: name → version. */
export function packageVersions(csproj: string): Record<string, string> {
  return Object.fromEntries([...csproj.matchAll(/<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g)].filter((m) => !/^Microsoft\.AspNetCore\.Components\.WebAssembly/.test(m[1]!)).map((m) => [m[1]!, m[2]!]));
}

export function testProject(packages: Record<string, string>): string {
  const refs = Object.entries({ ...TEST_PACKAGES, ...packages }).map(([name, version]) => `    <PackageReference Include="${name}" Version="${version}" />`);
  return `<Project Sdk="Microsoft.NET.Sdk.Razor">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>Generated</RootNamespace>
    <OutputType>Exe</OutputType>
    <IsPackable>false</IsPackable>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
${refs.join("\n")}
  </ItemGroup>
</Project>
`;
}

export function imports(usings: string[]): string {
  return ["Microsoft.AspNetCore.Components.Web", ...usings].map((u) => `@using ${u}`).join("\n") + "\n";
}

const unescape = (s: string) => s.replace(/&#xD;/g, "").replace(/&#xA;/g, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** dotnet test's results file (TRX): each test, and the first lines of a failure's message. */
export function trxResults(xml: string): TestRunResult & { status: "ran" } {
  const tests: { name: string; status: "passed" | "failed" | "skipped"; error?: string }[] = [];
  for (const m of xml.matchAll(/<UnitTestResult\b([^>]*?)(\/>|>([\s\S]*?)<\/UnitTestResult>)/g)) {
    const attrs = m[1]!;
    const name = /testName="([^"]*)"/.exec(attrs)?.[1] ?? "test";
    const outcome = /outcome="([^"]*)"/.exec(attrs)?.[1] ?? "Failed";
    const message = /<Message>([\s\S]*?)<\/Message>/.exec(m[3] ?? "")?.[1];
    const status = outcome === "Passed" ? "passed" : outcome === "NotExecuted" ? "skipped" : "failed";
    tests.push({ name: unescape(name).replace(/^.*\./, ""), status, ...(status === "failed" && message && { error: unescape(message).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" ").slice(0, 400) }) });
  }
  return { status: "ran", runner: RUNNER, tests };
}

/** The compiler's errors in dotnet's output: "Card.razor(12,5): error CS0246: …", each once. */
export function compileErrors(output: string): string {
  const seen = new Set<string>();
  for (const m of output.matchAll(/([A-Za-z]\w*\.(?:razor|cs))\((\d+),(\d+)\): error (\w+): ([^\[\r\n]*)/g)) seen.add(`${m[1]}:${m[2]}:${m[3]}: [${m[4]}] ${m[5]!.trim()}`);
  return [...seen].slice(0, 12).join("\n");
}

export interface Source {
  name: string;
  content: string;
}

/** The component's files and its test go into the test project's folder; the test sees the component's namespace. */
export function writeSources(dir: string, sources: Source[]): string | undefined {
  for (const s of sources) {
    if (!/^[A-Z]\w*(\.razor|\.razor\.css|Test\.cs)$/.test(s.name)) return `not a component or test file name: ${s.name}`;
    const content = s.name.endsWith("Test.cs") && !/^\s*using\s+Generated\s*;/m.test(s.content) ? `using Generated;\n${s.content}` : s.content;
    writeFileSync(join(dir, s.name), content);
  }
  return undefined;
}

/** Runs dotnet test in the prepared project, offline, and reads what it reported. */
export function runTests(dir: string, dotnet: string, user?: { uid?: number; gid?: number }, env: NodeJS.ProcessEnv = {}): Promise<TestRunResult> {
  return new Promise((done) => {
    const child = spawn(dotnet, ["test", "--no-restore", "-v", "q", "--logger", "trx;LogFileName=results.trx", "--results-directory", "results"], {
      cwd: dir,
      env,
      ...(user?.uid !== undefined && { uid: user.uid, gid: user.gid }),
    });
    let out = "";
    child.stdout.on("data", (d) => (out = (out + d).slice(-60_000)));
    child.stderr.on("data", (d) => (out = (out + d).slice(-60_000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.on("close", () => {
      clearTimeout(timer);
      const trx = join(dir, "results", "results.trx");
      if (existsSync(trx)) {
        const r = trxResults(readFileSync(trx, "utf8"));
        return done(r.tests.length ? r : { ...r, fileError: "the test file declares no tests" });
      }
      const errors = compileErrors(out);
      if (errors) return done({ status: "ran", runner: RUNNER, tests: [], fileError: errors });
      done({ status: "failed", reason: `the tests did not run: ${out.split(/\r?\n/).filter((l) => /error|Exception/i.test(l)).slice(0, 2).join(" ").slice(0, 400) || "dotnet test reported nothing"}` });
    });
  });
}

/** The component's files beside a test: everything but other tests. */
export function sourcesBeside(folder: string, testFile: string): Source[] {
  return readdirSync(folder)
    .filter((f) => /\.razor(\.css)?$/.test(f) || f === testFile)
    .map((f) => ({ name: f, content: readFileSync(join(folder, f), "utf8") }));
}
