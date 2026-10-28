# Tulpar for VS Code

**Figma frames and screenshots in, verified components out — built with your design system.**

Tulpar writes the component with your design system's real components and tokens (Carbon, Material UI, Chakra UI, Radix Themes, PrimeNG, Element Plus, Shoelace, or your own from npm). Then it builds the component, renders it in a sandboxed browser and checks it against the design before you see it. Anything that fails goes back to the model to fix, and the report tells you what it checked and what it couldn't.

Frameworks: **React, Vue, Angular, Svelte, Web Components**. You pick the language and styling your team writes: TypeScript or JavaScript with CSS, CSS Modules, SCSS, Less, Tailwind CSS, styled-components or Emotion.

## Get started

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Tulpar: Sign in**.
   Your browser opens tulparsi.com: sign in with GitHub and click **Connect VS Code**. The free trial needs no card.
2. Run **Tulpar: Generate component from Figma or a screenshot**, or right-click a folder in the Explorer.
3. Choose the design system, the language and styling, and paste a Figma frame link (in Figma: select the frame → right-click → *Copy link to selection*) or pick a screenshot.
4. Name the component and choose the folder. Tulpar writes the files, opens the component and shows the verification report. The final render opens beside your code.

## What gets checked

- **Design-system components:** the right ones are used, and none are invented.
- **Tokens:** no hard-coded colours, spacing or type, and each token used for what it means.
- **Layout:** every element's position and size against the design.
- **Text and typeface:** as designed.
- **Pixels:** the render compared with the design or screenshot.
- **Tests:** the generated tests run in a real browser.

## Privacy

- Your Figma token is kept in VS Code's encrypted secret storage. It is sent only with a generation, to read that frame, and is never stored on the server.
- Designs and generated code are deleted from the server within an hour, and working files on disk as soon as the generation finishes.
- Generated code runs only in a sandboxed browser with the network blocked.
- To disconnect every app from your account, use **Sign out of all apps** at [tulparsi.com/connect](https://tulparsi.com/connect).

## Commands

| Command | What it does |
| --- | --- |
| Tulpar: Sign in / Sign out | Connect this editor to your Tulpar account. |
| Tulpar: Generate component from Figma or a screenshot | Generate, verify and write the files. |
| Tulpar: Ask for a change to the last component | Say what to change ("make the button full width"). Your files, with your own edits, are changed and checked again. One generation; for an hour after the result. |
| Tulpar: Forget my Figma token | Remove the saved Figma token from this machine. |
| Tulpar: Verify this file against a Figma frame | Check your own file against a frame (needs a local Tulpar repository, see below). |

## Running everything on your machine

To generate with your own OpenAI key and verify your own files, clone [the Tulpar repository](https://github.com/hmamut39/Tulpar) and set **tulpar.repoPath** to it. Generation then runs locally instead of on tulparsi.com.

---

Plans and pricing: [tulparsi.com/pricing](https://tulparsi.com/pricing) · Created by Mamuti Aishan (Hasan) · [Terms](https://tulparsi.com/terms) · [Privacy](https://tulparsi.com/privacy)
