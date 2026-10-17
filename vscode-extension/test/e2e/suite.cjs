// Runs inside VS Code's extension host (see run.mts): the extension as a user gets it, against a local
// Tulpar server. Exercises activation, the commands, the sign-in callback (as the browser delivers it),
// the token in secret storage, and the account shown in the status bar.
"use strict";
const assert = require("node:assert/strict");
const vscode = require("vscode");

const token = process.env.TULPAR_E2E_TOKEN;

async function until(check, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const steps = [];
function step(name, fn) {
  steps.push({ name, fn });
}

let api;

step("activates and registers its commands", async () => {
  const ext = vscode.extensions.getExtension("tulparsi.tulpar");
  assert.ok(ext, "the extension is installed");
  api = await ext.activate();
  assert.ok(api, "test mode exposes the test hooks");
  const commands = await vscode.commands.getCommands(true);
  for (const c of ["tulpar.generate", "tulpar.signIn", "tulpar.signOut", "tulpar.forgetFigmaToken", "tulpar.verify"]) assert.ok(commands.includes(c), `${c} is registered`);
});

step("points the signed-out user to sign in", async () => {
  await api.signOut();
  await api.refreshStatus();
  assert.equal(api.statusText(), "$(sparkle) Tulpar");
  assert.equal(await api.hasToken(), false);
});

step("refuses a sign-in callback this window did not start", async () => {
  api.startSignIn();
  await api.deliverCallback(`token=${token}&state=${"0".repeat(32)}`);
  assert.equal(await api.hasToken(), false, "a callback with another state is ignored");
});

step("signs in from the browser's callback and shows the account's allowance", async () => {
  const state = api.startSignIn();
  await api.deliverCallback(`token=${encodeURIComponent(token)}&state=${state}`);
  assert.equal(await api.hasToken(), true, "the token is in secret storage");
  const text = await until(async () => {
    await api.refreshStatus();
    return /left/.test(api.statusText()) && api.statusText();
  }, "the status bar to show the allowance");
  assert.match(text, /Tulpar · 20 left/);
});

step("signs out", async () => {
  await api.signOut();
  assert.equal(await api.hasToken(), false);
});

exports.run = async function run() {
  const failures = [];
  for (const s of steps) {
    try {
      await s.fn();
      console.log(`  ✓ ${s.name}`);
    } catch (err) {
      failures.push(s.name);
      console.log(`  ✗ ${s.name}\n      ${err && err.stack ? err.stack.split("\n").slice(0, 3).join("\n      ") : err}`);
    }
  }
  if (failures.length) throw new Error(`${failures.length} end-to-end step(s) failed: ${failures.join("; ")}`);
};
