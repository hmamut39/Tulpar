# Tulpar

**Figma frames and screenshots in, verified components out — built with your design system.**

*Tulpar (تۇلپار) is the winged horse of Turkic legend.*

Tulpar writes a component from a Figma frame or a screenshot using your design system's real components and tokens. It then builds the component, renders it in a sandboxed browser, and checks it against the design before you see it. Anything that fails goes back to the model to fix, and the report says what was checked and what could not be.

**Use it:** [tulparsi.com](https://tulparsi.com) (free trial, no card) · VS Code: [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tulparsi.tulpar) or [Open VSX](https://open-vsx.org/extension/tulparsi/tulpar) (Cursor, Windsurf, VSCodium) · the CLI and MCP server in this repository.

## The rule

Tulpar never says something is right unless it has checked. Where it cannot check, it says so. A partial result is never reported as a success.

A real report (Vue + Element Plus, from a screenshot):

```
SignInCard
  ✓ built and rendered
  ✓ 8 of 8 design-system components used, 0 invented
  ✓ 0 hard-coded colours, type styles, spacing or size values
  ✓ layout within tolerance on 11/11 elements
  ✓ text matches exactly (8)
  ✓ typeface class as designed on 8/8 elements
  ✓ 2 of 2 generated tests pass · Vitest in Chromium
  ✓ 4.6% of pixels differ from the screenshot (limit 8.0%)
  ✓ 6 of 6 interactive elements show visible focus, keep their layout and design-system colours in every state
Verdict: VERIFIED
```

## What it supports

| | |
| --- | --- |
| **Frameworks** | React, Vue, Angular, Svelte, Web Components, Flutter, Blazor (C#) |
| **Languages and styling** | TypeScript or JavaScript; CSS, CSS Modules, SCSS, Less, Tailwind CSS (strict: values only from your tokens), styled-components, Emotion — as the framework allows |
| **Design systems built in** | Carbon (React, Angular, Web Components, Svelte), Material UI, Chakra UI, Radix Themes, shadcn/ui (components in your own source, styled with your Tailwind theme), PrimeNG, Element Plus, Shoelace — or any design system on npm, added from the web page or with `tulpar init` |
| **Input** | A Figma frame link, a screenshot, or both |

## What it checks

- **Design-system components:** the ones the design calls for are used, and none are invented.
- **Tokens:** no hard-coded colours, type or spacing; tokens chosen by meaning; a design colour your system has no token for is reported for the designer, not blamed on the code.
- **Layout and text:** every element's box against the design, and the text character for character.
- **Typeface:** the class of typeface drawn, as designed.
- **Pixels:** the render compared with the screenshot or Figma's image, with the differing regions named.
- **States:** each interactive element hovered, pressed and keyboard-focused for real: focus must be visible (WCAG 2.4.7), the layout must not shift, state colours must be tokens.
- **Tests:** the generated tests run in a real browser (Vitest browser mode), and are written to test what a user sees and does.

## Run it yourself

```sh
cp .env.example .env        # add your OpenAI key
npm install
npm run web                 # the web page, at http://localhost:4173
npm test

# Your own project: detect the framework, design system and tokens, write tulpar.json
npm run tulpar -- init path/to/your/app
npm run tulpar -- generate path/to/your/app --image design.png --name CheckoutCard --styling tailwind
npm run tulpar -- verify examples/carbon-react impl/modal-footer.tsx --frame 3906:50588
npm run mcp                 # the MCP server, for AI coding assistants
```

## Architecture

- **Core.** Framework-free: the design model from Figma or a screenshot, the component index, matching, generation and verification.
- **Adapters.** One per target stack (`adapters/`), running as separate programs that talk to the core over a JSON protocol: React, Vue, Angular, Svelte, Web Components. A SwiftUI adapter could be written in Swift without changing the core.
- **Where it runs.** The web page (tulparsi.com), the VS Code extension, the CLI, CI, and an MCP tool your AI agent can call. Generated code runs only in sandboxed Chromium with the network blocked.
- **Delivery.** Every push runs the whole test suite (adapters against real design systems, the extension end to end inside VS Code, an accessibility audit of the pages) and builds the production image; the deploy releases that tested image, checks the live site, and rolls back if it is unhealthy.

The plan and the steps that built it are in [docs/](docs/00-research-and-plan.md).

**Next targets:** Java (Vaadin), Rust (Leptos), Kotlin (Compose), SwiftUI.

## Creator

Tulpar was created by **Mamuti Aishan (Hasan)** ([GitHub](https://github.com/hmamut39)). Live at **[tulparsi.com](https://tulparsi.com)**.

## License

No license has been chosen yet. Until one is added, all rights are reserved.
