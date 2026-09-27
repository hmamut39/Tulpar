# G8: Tulpar in the editor — MCP server and VS Code extension (2026-09-27)

Two ways into the editor, on the same engine as the command line and the web page.

## 1. The MCP server: any AI coding assistant

MCP (Model Context Protocol) is how AI assistants call tools. [mcp/src/server.ts](../mcp/src/server.ts) (on the official `@modelcontextprotocol/server` 2.1) gives them three tools:

| Tool | What it does |
|---|---|
| `tulpar_projects` | Lists the design systems and frameworks available (Carbon Web Components, React, Angular…) |
| `tulpar_generate` | From a Figma frame link and/or a screenshot: generate → verify → repair. Returns the files and the full report, and can write the files into a folder. **It never overwrites existing files unless asked** (tested). |
| `tulpar_verify` | Checks existing code against a Figma frame, including its test file |

It runs locally, with this machine's keys (`.env`).

**Set up**

- **Claude Code:** already configured by this repository's [.mcp.json](../.mcp.json); Claude Code offers to enable it when you open the folder. Elsewhere: `claude mcp add tulpar -- node <path-to-Tulpar>/mcp/src/server.ts`.
- **VS Code (Copilot agent mode):** already configured by [.vscode/mcp.json](../.vscode/mcp.json) for this workspace. Elsewhere, add the same entry to that project's `.vscode/mcp.json`.
- **Cursor:** add to `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`):
  ```json
  { "mcpServers": { "tulpar": { "command": "node", "args": ["<path-to-Tulpar>/mcp/src/server.ts"] } } }
  ```

Then ask your assistant, for example: *"Use Tulpar to generate CheckoutCard for carbon-react from this Figma link, into src/components."*

A generation takes 30–120 seconds (building, rendering and running tests). If your client times tools out sooner, raise its MCP tool timeout.

**Tested:**
- a real MCP client over an in-memory transport: tool list, projects, input errors, a full generation with the generated tests run, the no-overwrite rule, and verification;
- a separate stdio process, exactly as editors start it: a full Angular verification, spec included.

## 2. The VS Code extension

[vscode-extension/](../vscode-extension) contributes two commands (Command Palette, `Ctrl+Shift+P`):
- **Tulpar: Generate component from Figma or a screenshot:** pick the project, the Figma link and/or screenshot, the name and the target folder.
  - Progress shows while it runs.
  - Files are written into the folder; if any already exist, it asks first.
  - The main file opens, and the checks appear in the **Tulpar** output panel.
- **Tulpar: Verify this file against a Figma frame:** checks the open file, and runs its test file if one sits next to it (`Card.test.tsx`, `card.component.spec.ts`).

It runs the Tulpar CLI with `--json` (new on `generate` and `verify`), so it gets the same pipeline and keys.

**Install**

```sh
cd vscode-extension
npx @vscode/vsce package --skip-license --no-dependencies -o ../out/tulpar-0.1.0.vsix
```

Then in VS Code: Extensions → `…` → **Install from VSIX…** → `out/tulpar-0.1.0.vsix`. If the Tulpar folder isn't open in the window, set **Settings → Tulpar: Repo Path** to it. **Tulpar: Node Path** must point to Node.js 24 or newer.

**Tested:** the extension's logic (finding the repo and projects, the project of a file, the test file next to it, collisions, CLI arguments, reading the `--json` result), and packaging. **Not tested here:** the clicks in VS Code's own UI, because no VS Code extension host runs on this machine. Installing the `.vsix` is its first real test.

## What the extension still lacks

- **Publishing** to the VS Code Marketplace (needs a publisher account and a licence decision).
- **Choosing a design system from the user's own repository** (G9, next): today the projects are the built-in examples, plus any open folder with a `tulpar.json`.
