// End-to-end test of the extension inside a real VS Code: a local Tulpar server with a signed-in
// account, and VS Code (downloaded by @vscode/test-electron) running the extension against it.
// Run: node vscode-extension/test/e2e/run.ts   (in CI under xvfb-run on Linux)

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";
import { Accounts } from "../../../web/src/accounts.ts";
import { startServer } from "../../../web/src/server.ts";

const repo = resolve(import.meta.dirname, "../../..");
const accounts = new Accounts(":memory:", { trial: 20, pro: 300 });
const auth = { clientId: "id", clientSecret: "secret", sessionSecret: "e2e-secret", origin: "http://localhost", secureCookies: false };
// No model: the test never generates (that would cost money); it checks everything up to it.
const server = await startServer({ repoRoot: repo, llm: () => undefined, auth, accounts, log: () => {} }, 0);

// The account the browser sign-in would create, and the token /connect would hand to the editor.
const account = accounts.signIn({ githubId: 1, login: "e2e-user", name: "E2E", email: null });
const token = accounts.createToken(account.id, "vscode");

// A workspace whose settings point the extension at the local server.
const workspace = mkdtempSync(join(tmpdir(), "tulpar-e2e-"));
mkdirSync(join(workspace, ".vscode"));
writeFileSync(join(workspace, ".vscode", "settings.json"), JSON.stringify({ "tulpar.server": server.url }));

// Launched from inside an editor, this variable would make VS Code start as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

let code = 0;
try {
  await runTests({
    extensionDevelopmentPath: resolve(import.meta.dirname, "../.."),
    extensionTestsPath: resolve(import.meta.dirname, "suite.cjs"),
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust"],
    extensionTestsEnv: { TULPAR_E2E_TOKEN: token, TULPAR_E2E_SERVER: server.url },
  });
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
