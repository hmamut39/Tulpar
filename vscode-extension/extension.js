// Tulpar for VS Code: generate a component from a Figma frame or a screenshot into the workspace.
//
// By default it works through tulparsi.com with the user's Tulpar account (free trial or Pro):
// "Tulpar: Sign in" opens the site, which hands a token back to this window; the token is kept in
// VS Code's encrypted secret storage. With "tulpar.repoPath" set to a local Tulpar repository, it
// runs the CLI on this machine instead, with the machine's own keys (.env), and can also verify
// the open file against a Figma frame.
"use strict";
const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const lib = require("./lib.js");

const TOKEN = "tulpar.token";
const FIGMA_TOKEN = "tulpar.figmaToken";

let output;
let context;
let statusItem;
let pendingState;

function activate(ctx) {
  context = ctx;
  output = vscode.window.createOutputChannel("Tulpar");
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  statusItem.command = "tulpar.generate";
  ctx.subscriptions.push(
    output,
    statusItem,
    vscode.commands.registerCommand("tulpar.generate", generate),
    vscode.commands.registerCommand("tulpar.verify", verify),
    vscode.commands.registerCommand("tulpar.signIn", signIn),
    vscode.commands.registerCommand("tulpar.signOut", signOut),
    vscode.commands.registerCommand("tulpar.forgetFigmaToken", async () => {
      await ctx.secrets.delete(FIGMA_TOKEN);
      vscode.window.showInformationMessage("Tulpar: your Figma token was removed from this machine.");
    }),
    vscode.window.registerUriHandler({ handleUri }),
  );
  refreshStatus();
  // For the end-to-end tests only (VS Code runs the extension in Test mode there): start a sign-in
  // without opening a browser, deliver the browser's callback, and read what the user would see.
  if (ctx.extensionMode === vscode.ExtensionMode.Test) {
    return {
      startSignIn: () => (pendingState = randomBytes(16).toString("hex")),
      deliverCallback: (query) => handleUri(vscode.Uri.parse(`${vscode.env.uriScheme}://${ctx.extension.id}/auth?${query}`)),
      refreshStatus,
      statusText: () => statusItem.text,
      hasToken: async () => !!(await ctx.secrets.get(TOKEN)),
      signOut,
    };
  }
}

function settings() {
  const c = vscode.workspace.getConfiguration("tulpar");
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  return { repo: lib.findRepo(c.get("repoPath"), folders), node: c.get("nodePath") || "node", server: c.get("server") || "https://tulparsi.com", folders };
}

// ---- Signing in to tulparsi.com ----

async function signIn() {
  pendingState = randomBytes(16).toString("hex");
  const url = lib.connectUrl(settings().server, vscode.env.uriScheme, context.extension.id, pendingState);
  await vscode.env.openExternal(vscode.Uri.parse(url));
  vscode.window.showInformationMessage("Tulpar: finish signing in in your browser, then come back here.");
}

async function handleUri(uri) {
  if (uri.path !== "/auth") return;
  const token = lib.tokenFromCallback(uri.query, pendingState);
  if (!token) return void vscode.window.showErrorMessage('Tulpar: that sign-in link was not started from this window. Run "Tulpar: Sign in" again.');
  pendingState = undefined;
  await context.secrets.store(TOKEN, token);
  const me = await refreshStatus();
  vscode.window.showInformationMessage(`Tulpar: signed in${me?.login ? ` as @${me.login}` : ""}.`, "Generate a component").then((a) => a && generate());
}

async function signOut() {
  await context.secrets.delete(TOKEN);
  refreshStatus();
  vscode.window.showInformationMessage("Tulpar: signed out on this machine. To revoke the key everywhere, use “Sign out of all apps” on tulparsi.com/connect.");
}

/** Calls tulparsi.com as the signed-in account. Errors carry the server's message and what to do about it. */
async function api(method, route, body) {
  const token = await context.secrets.get(TOKEN);
  const res = await fetch(new URL(route, settings().server), {
    method,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body && { "content-type": "application/json" }), "user-agent": `tulpar-vscode/${context.extension.packageJSON.version}` },
    ...(body && { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `tulparsi.com answered ${res.status}.`);
    err.signIn = !!data.signIn || res.status === 401;
    err.upgrade = !!data.upgrade;
    throw err;
  }
  return data;
}

async function refreshStatus() {
  if (settings().repo || !(await context.secrets.get(TOKEN))) {
    statusItem.text = "$(sparkle) Tulpar";
    statusItem.tooltip = settings().repo ? "Tulpar (local repository): generate a component" : "Tulpar: sign in to generate components";
    statusItem.command = settings().repo ? "tulpar.generate" : "tulpar.signIn";
    statusItem.show();
    return undefined;
  }
  try {
    const me = await api("GET", "/api/me");
    const left = me.allowance?.remaining;
    statusItem.text = `$(sparkle) Tulpar${typeof left === "number" ? ` · ${left} left` : ""}`;
    statusItem.tooltip = `Signed in as @${me.login} (${me.allowance?.plan === "pro" ? "Pro" : "free trial"}). Click to generate a component.`;
    statusItem.command = "tulpar.generate";
    statusItem.show();
    return me;
  } catch {
    statusItem.text = "$(sparkle) Tulpar";
    statusItem.tooltip = "Tulpar: sign in again to generate components";
    statusItem.command = "tulpar.signIn";
    statusItem.show();
    return undefined;
  }
}

// ---- Generating ----

// From the Explorer's context menu, the folder clicked is where the files go by default.
async function generate(folder) {
  const { repo } = settings();
  const preferred = folder instanceof vscode.Uri ? folder.fsPath : undefined;
  return repo ? generateLocal(preferred) : generateHosted(preferred);
}

/** What every generation asks: where the design comes from, the name, and where the files go. */
async function askDesign({ needsFigmaToken, preferred }) {
  const source = await vscode.window.showQuickPick(["Figma frame link", "Screenshot", "Both"], { title: "Generate from" });
  if (!source) return undefined;
  let figmaUrl;
  let screenshot;
  let figmaToken;
  if (source !== "Screenshot") {
    figmaUrl = await vscode.window.showInputBox({ title: "Figma frame link", prompt: "In Figma: select the frame → right-click → Copy link to selection", ignoreFocusOut: true, validateInput: (v) => (/figma\.com\/.+node-id=/.test(v) ? undefined : "A Figma link to a frame (it contains node-id=)") });
    if (!figmaUrl) return undefined;
    if (needsFigmaToken) {
      // The user's own Figma token reads their file; kept in secret storage, sent only with a generation.
      figmaToken = await context.secrets.get(FIGMA_TOKEN);
      if (!figmaToken) {
        figmaToken = await vscode.window.showInputBox({ title: "Your Figma personal access token", prompt: "Figma → Settings → Security → Personal access tokens (scope: file content, read-only). Kept in VS Code's encrypted storage.", password: true, ignoreFocusOut: true, validateInput: (v) => (v.trim().length >= 20 ? undefined : "Paste the token Figma showed you") });
        if (!figmaToken) return undefined;
        figmaToken = figmaToken.trim();
        await context.secrets.store(FIGMA_TOKEN, figmaToken);
      }
    }
  }
  if (source !== "Figma frame link") {
    const files = await vscode.window.showOpenDialog({ title: "Screenshot of the design", canSelectMany: false, filters: { Images: ["png", "jpg", "jpeg", "webp"] } });
    if (!files?.[0]) return undefined;
    screenshot = files[0].fsPath;
  }
  const name = await vscode.window.showInputBox({ title: "Component name", prompt: "PascalCase, e.g. CheckoutCard", ignoreFocusOut: true, validateInput: (v) => (lib.isPascalCase(v) ? undefined : "PascalCase, e.g. CheckoutCard") });
  if (!name) return undefined;
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const folders = settings().folders;
  const target = await vscode.window.showOpenDialog({
    title: "Where should the files go?",
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: "Put the files here",
    ...(preferred || active || folders[0] ? { defaultUri: vscode.Uri.file(preferred ?? (active ? path.dirname(active) : folders[0])) } : {}),
  });
  if (!target?.[0]) return undefined;
  return { figmaUrl, screenshot, figmaToken, name, targetDir: target[0].fsPath };
}

async function generateHosted(preferred) {
  if (!(await context.secrets.get(TOKEN))) {
    const a = await vscode.window.showInformationMessage("Tulpar: sign in with your Tulpar account (free trial, no card) to generate components.", "Sign in");
    if (a) signIn();
    return;
  }
  let config;
  try {
    config = await api("GET", "/api/config");
  } catch (e) {
    return void vscode.window.showErrorMessage(`Tulpar: ${e.message}`);
  }
  const pick = await vscode.window.showQuickPick(
    config.projects.map((p) => ({ label: p.label, description: p.id, project: p })),
    { title: "Tulpar: which design system and framework?", matchOnDescription: true, placeHolder: "To add your own design system from npm, use tulparsi.com (Design system → Add from npm)" },
  );
  if (!pick) return;
  let outputChoice;
  const outputs = lib.OUTPUTS[pick.project.adapter];
  if (outputs) {
    const remembered = context.globalState.get(`tulpar.output.${pick.project.adapter}`);
    const chosen = await vscode.window.showQuickPick(
      outputs.map(([value, label]) => ({ label, value, ...(value === remembered && { description: "last used" }) })).sort((a, b) => Number(b.value === remembered) - Number(a.value === remembered)),
      { title: "Language and styling" },
    );
    if (!chosen) return;
    outputChoice = chosen.value;
    context.globalState.update(`tulpar.output.${pick.project.adapter}`, outputChoice);
  }
  const design = await askDesign({ needsFigmaToken: !config.figmaTokenOnServer, preferred });
  if (!design) return;

  output.clear();
  output.show(true);
  output.appendLine(`Generating ${design.name} with ${pick.project.label} on tulparsi.com…`);
  let job;
  try {
    job = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Tulpar: ${design.name}`, cancellable: true }, async (progress, cancel) => {
      const { id } = await api("POST", "/api/jobs", lib.jobBody({ project: pick.project.id, name: design.name, figmaUrl: design.figmaUrl, screenshot: design.screenshot, figmaToken: design.figmaToken, output: outputChoice }));
      let shown = 0;
      for (;;) {
        if (cancel.isCancellationRequested) throw new Error("Stopped watching. The generation still finishes on tulparsi.com and counts toward your plan.");
        const current = await api("GET", `/api/jobs/${id}`);
        for (const e of current.events.slice(shown)) output.appendLine(`  ${e.text}`);
        if (current.events.length > shown) progress.report({ message: current.events.at(-1).text });
        else if (current.state === "queued") progress.report({ message: "waiting for a free slot…" });
        shown = current.events.length;
        if (current.state === "done" || current.state === "error") return current;
        await new Promise((r) => setTimeout(r, 1500));
      }
    });
  } catch (e) {
    return reportApiError(e);
  }
  refreshStatus();
  const result = lib.fromJob(job);
  if (!result.ok) return void vscode.window.showErrorMessage(`Tulpar: ${result.error}`);
  if (job.hasRender) await saveRender(job.id, design.name).catch(() => undefined);
  await deliver(result, design.name, design.targetDir);
}

function reportApiError(e) {
  if (e.upgrade) {
    return void vscode.window.showWarningMessage(`Tulpar: ${e.message}`, "See plans").then((a) => a && vscode.env.openExternal(vscode.Uri.parse(new URL("/pricing", settings().server).href)));
  }
  if (e.signIn) return void vscode.window.showWarningMessage(`Tulpar: ${e.message}`, "Sign in").then((a) => a && signIn());
  return void vscode.window.showErrorMessage(`Tulpar: ${e.message}`);
}

/** The final render, kept with the extension's own storage (not in the user's project) and opened beside the code. */
async function saveRender(id, name) {
  const token = await context.secrets.get(TOKEN);
  const res = await fetch(new URL(`/api/jobs/${id}/render.png`, settings().server), { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return;
  const dir = vscode.Uri.joinPath(context.globalStorageUri, "renders");
  await vscode.workspace.fs.createDirectory(dir);
  const file = vscode.Uri.joinPath(dir, `${name}.png`);
  await vscode.workspace.fs.writeFile(file, new Uint8Array(await res.arrayBuffer()));
  output.appendLine(`Render: ${file.fsPath}`);
  context.workspaceState.update("tulpar.lastRender", file.toString());
}

/** Writes the files (asking before replacing any), shows the report, and opens the component. */
async function deliver(result, name, targetDir) {
  const clashes = lib.collisions(targetDir, result.files);
  if (clashes.length) {
    const answer = await vscode.window.showWarningMessage(`These files already exist:\n${clashes.map((c) => path.basename(c)).join(", ")}`, { modal: true }, "Replace them");
    if (answer !== "Replace them") {
      output.appendLine("Not written: the files exist.");
      return;
    }
  }
  for (const f of result.files) {
    const dest = path.join(targetDir, f.path);
    // Paths come from a model: never outside the chosen folder.
    if (!path.resolve(dest).startsWith(path.resolve(targetDir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  if (result.report) output.appendLine(lib.reportLines(result.report).join("\n"));
  output.appendLine(`\n${result.attempts} attempt(s) with ${result.model}. Files written to ${targetDir}`);
  const main = result.files[0];
  if (main) await vscode.window.showTextDocument(vscode.Uri.file(path.join(targetDir, main.path)));
  const status = { verified: "verified: every check passed", "unchecked-remain": "no check failed; some could not be checked", failed: "some checks still fail — see the report" }[result.status];
  const render = context.workspaceState.get("tulpar.lastRender");
  const actions = ["Show report", ...(render ? ["Show render"] : [])];
  (result.status === "failed" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(`Tulpar: ${name} — ${status}.`, ...actions).then((a) => {
    if (a === "Show report") output.show();
    if (a === "Show render") vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(render), vscode.ViewColumn.Beside);
  });
}

// ---- Local mode: the Tulpar repository on this machine ----

function runCli(node, repo, args, token) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd: repo });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => output.append(String(d)));
    token?.onCancellationRequested(() => child.kill());
    child.on("error", (e) => reject(new Error(`Could not start ${node}: ${e.message}. Set "tulpar.nodePath" to Node.js 24 or newer.`)));
    child.on("close", () => {
      try {
        resolve(lib.parseResult(stdout));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function generateLocal(preferred) {
  const { repo, node, folders } = settings();
  const projects = lib.findProjects(repo, folders);
  const pick = await vscode.window.showQuickPick(
    projects.map((p) => ({ label: p.id, description: p.adapter, project: p })),
    { title: "Tulpar: which design system and framework?" },
  );
  if (!pick) return;
  const design = await askDesign({ needsFigmaToken: false, preferred });
  if (!design) return;
  output.clear();
  output.show(true);
  output.appendLine(`Generating ${design.name} for ${pick.project.id}…`);
  let result;
  try {
    result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Tulpar: generating ${design.name} (writing, building, rendering, checking — about a minute)`, cancellable: true },
      (_progress, token) => runCli(node, repo, lib.generateArgs({ repo, project: pick.project.dir, name: design.name, figmaUrl: design.figmaUrl, screenshot: design.screenshot }), token),
    );
  } catch (e) {
    return void vscode.window.showErrorMessage(`Tulpar: ${e.message}`);
  }
  if (!result.ok) return void vscode.window.showErrorMessage(`Tulpar: ${result.error}`);
  context.workspaceState.update("tulpar.lastRender", undefined);
  await deliver(result, design.name, design.targetDir);
}

async function verify() {
  const { repo, node } = settings();
  if (!repo) return void vscode.window.showInformationMessage('Tulpar: verifying a file runs the checks on this machine. Set "tulpar.repoPath" to a local copy of the Tulpar repository (github.com/hmamut39/Tulpar).');
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!file) return void vscode.window.showErrorMessage("Tulpar: open the implementation file to verify.");
  const project = lib.projectOf(file);
  if (!project) return void vscode.window.showErrorMessage("Tulpar: this file is not inside a Tulpar project (no tulpar.json above it).");
  const figmaUrl = await vscode.window.showInputBox({ title: "The Figma frame this file implements", ignoreFocusOut: true, validateInput: (v) => (/figma\.com\/.+node-id=/.test(v) ? undefined : "A Figma link to a frame (it contains node-id=)") });
  if (!figmaUrl) return;
  const test = lib.testFileFor(file);
  output.clear();
  output.show(true);
  try {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Tulpar: verifying against the design", cancellable: true }, (_p, token) =>
      runCli(node, repo, lib.verifyArgs({ repo, project, entry: path.relative(project, file), figmaUrl, ...(test && { test: path.relative(project, test) }) }), token),
    );
    if (!result.ok) return void vscode.window.showErrorMessage("Tulpar: verification could not start; see the Tulpar output.");
    output.appendLine(lib.reportLines(result.report).join("\n"));
    const msg = { pass: "passes every check", incomplete: "no check failed; some could not be checked", fail: "fails some checks" }[result.report.verdict];
    (result.report.verdict === "fail" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(`Tulpar: ${path.basename(file)} ${msg}.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Tulpar: ${e.message}`);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
