// The .NET runner: runs a generated Blazor component's bUnit tests, one check per machine start. bUnit runs the
// component in .NET's memory, so generated C# runs here, never on the main server. This machine holds no secrets
// and has no public address; before serving it blocks all outgoing connections; the tests run as an unprivileged
// user; and after a check the process exits, so Fly starts the next one from a fresh image.
//
//   node deploy/dotnet-runner.ts --prepare <dir>   writes the test project (when the image is built, then restored)
//   node deploy/dotnet-runner.ts                   serves (TULPAR_RUNNER_LOCAL=1 on a developer machine: no firewall)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join, resolve } from "node:path";
import { imports, packageVersions, runTests, testProject, writeSources, type Source } from "../adapters/blazor/src/tests.ts";

const example = resolve(import.meta.dirname, "..", "examples", "blazor-mud");
const work = process.env.TULPAR_TEST_PROJECT ?? "/work";
const local = process.env.TULPAR_RUNNER_LOCAL === "1";
const dotnet = process.env.TULPAR_DOTNET ?? "/opt/dotnet/dotnet";

function prepare(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const csproj = readdirSync(example).find((f) => f.endsWith(".csproj"))!;
  const config = JSON.parse(readFileSync(join(example, "tulpar.json"), "utf8")).blazor;
  writeFileSync(join(dir, "Tests.csproj"), testProject(packageVersions(readFileSync(join(example, csproj), "utf8"))));
  writeFileSync(join(dir, "_Imports.razor"), imports(config.harness?.usings ?? []));
  // One component and test, so the image's build compiles everything a check needs once.
  writeFileSync(join(dir, "Warm.razor"), "<p>Warm</p>\n");
  writeFileSync(join(dir, "WarmTest.cs"), "using Bunit;\nusing Xunit;\n\npublic class WarmTest : BunitContext\n{\n    [Fact]\n    public void Draws() => Assert.Equal(\"Warm\", Render<Generated.Warm>().Find(\"p\").TextContent);\n}\n");
}

if (process.argv[2] === "--prepare") {
  prepare(resolve(process.argv[3] ?? work));
  console.log("test project written");
} else {
  // Fail closed: without the firewall, generated code could reach the network, so the runner does not serve.
  if (!local) {
    for (const tool of ["iptables", "ip6tables"]) {
      for (const rule of [["-A", "OUTPUT", "-o", "lo", "-j", "ACCEPT"], ["-A", "OUTPUT", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"], ["-P", "OUTPUT", "DROP"]]) {
        execFileSync(tool, rule, { stdio: "inherit" });
      }
    }
    console.log("Outgoing connections blocked");
  }
  const user = process.env.TULPAR_RUNNER_UID ? { uid: Number(process.env.TULPAR_RUNNER_UID), gid: Number(process.env.TULPAR_RUNNER_GID ?? process.env.TULPAR_RUNNER_UID) } : undefined;
  const env: NodeJS.ProcessEnv = {
    PATH: [resolve(dotnet, ".."), "/usr/bin", "/bin"].join(process.platform === "win32" ? ";" : ":"),
    HOME: "/tmp",
    DOTNET_CLI_HOME: "/tmp",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    ...(process.env.NUGET_PACKAGES && { NUGET_PACKAGES: process.env.NUGET_PACKAGES }),
    ...(process.platform === "win32" && { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramData: process.env.ProgramData }),
  };

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 2 * 1024 * 1024) throw new Error("too large");
      chunks.push(c as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  }

  let busy = false;
  createServer(async (req, res) => {
    const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    try {
      if (req.method === "GET" && req.url === "/healthz") return json(200, { ok: true });
      if (req.method !== "POST" || req.url !== "/test") return json(404, { ok: false });
      // One check per machine start: a machine that has run generated code never runs another.
      if (busy) return json(503, { status: "failed", reason: "This runner is busy." });
      busy = true;
      const b = await body(req);
      res.writeHead(200, { "content-type": "application/json" });
      const alive = setInterval(() => res.write(" "), 15_000);
      let result: unknown;
      try {
        for (const f of readdirSync(work)) if (/^Warm/.test(f)) rmSync(join(work, f), { force: true });
        const refused = writeSources(work, b.sources as Source[]);
        result = refused ? { status: "ran", runner: "bUnit with xUnit (.NET)", tests: [], fileError: refused } : await runTests(work, dotnet, user, env);
      } catch (err) {
        result = { status: "failed", reason: (err as Error).message.split("\n")[0] };
      } finally {
        clearInterval(alive);
      }
      res.end(JSON.stringify(result), () => {
        if (local) busy = false;
        else setTimeout(() => process.exit(0), 200);
      });
    } catch (err) {
      json(400, { status: "failed", reason: (err as Error).message.split("\n")[0] });
    }
  }).listen(Number(process.env.PORT ?? 8080), () => console.log(".NET runner ready"));
}
