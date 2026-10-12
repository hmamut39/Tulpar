// Connecting the VS Code extension: the signed-in visitor asks for a token for the extension, and
// the browser hands it to VS Code through its own link scheme (vscode://<extension>/auth). The
// extension sent a random state and accepts the token only with that state back.
import { initAccount, showNotice } from "./account.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Editors that run VS Code extensions, each with its own link scheme.
const SCHEMES = { vscode: "VS Code", "vscode-insiders": "VS Code Insiders", cursor: "Cursor", windsurf: "Windsurf", vscodium: "VSCodium" };
const scheme = Object.hasOwn(SCHEMES, params.get("scheme") ?? "") ? params.get("scheme") : "vscode";
const ext = /^[a-z0-9-]+\.tulpar$/.test(params.get("ext") ?? "") ? params.get("ext") : null;
const state = /^[a-f0-9]{32,64}$/.test(params.get("state") ?? "") ? params.get("state") : null;
const editor = SCHEMES[scheme];

const config = await (await fetch("/api/config")).json();
await initAccount(config);
$("connectGo").textContent = `Connect ${editor}`;

if (!ext || !state) {
  $("connectStatus").textContent = `Open this page from ${editor}: run "Tulpar: Sign in" from the Command Palette.`;
} else if (!config.signIn) {
  $("connectStatus").textContent = "Sign-in is not available on this server.";
} else {
  const me = await (await fetch("/api/me")).json();
  if (!me.signedIn) {
    $("connectStatus").textContent = `Sign in to connect ${editor} to your account.`;
    $("connectSignIn").href = `/auth/github?next=${encodeURIComponent(location.pathname + location.search)}`;
    $("connectSignIn").hidden = false;
  } else {
    $("connectStatus").textContent = `Signed in as @${me.login}.`;
    $("connectGo").hidden = false;
  }
}

$("connectGo").addEventListener("click", async () => {
  $("connectGo").disabled = true;
  try {
    const res = await fetch("/api/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: "vscode" }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Could not connect.");
    location.href = `${scheme}://${ext}/auth?token=${encodeURIComponent(body.token)}&state=${encodeURIComponent(state)}`;
    $("connectStatus").textContent = `Done. Your browser may ask to open ${editor}: allow it, then go back to ${editor}.`;
    $("connectGo").hidden = true;
  } catch (err) {
    showNotice(err.message);
    $("connectGo").disabled = false;
  }
});

$("connectRevoke").addEventListener("click", async () => {
  const res = await fetch("/api/tokens/revoke", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  showNotice(res.ok ? `Signed out of ${body.revoked || 0} app(s).` : body.error || "Sign in first.");
});
