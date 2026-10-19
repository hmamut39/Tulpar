# Tulpar for Figma

Select a frame in Figma, press **Generate component**, and get it as code in your design system, built, rendered and checked by tulparsi.com. Then ask for changes in words.

The plugin sends a picture of the selected frame (exported by Figma at 2×, or 1× for very large frames) to tulparsi.com. It needs no Figma token. Generations count toward the Tulpar account's free trial or Pro plan.

## Files

- `manifest.json`: the plugin's identity. It may reach `https://tulparsi.com` only (and `http://localhost:4173` while developing).
- `code.js`: runs inside Figma. It reads the selection, exports the picture and keeps the key in Figma's storage on that computer.
- `ui.html`: the panel. It talks to tulparsi.com with the key (`Authorization: Bearer tlp_…`).
- `test/plugin.test.ts`: runs `code.js` against a stand-in for Figma's API.

## Try it in Figma (desktop app)

1. In Figma: **Plugins → Development → Import plugin from manifest…**, and pick `figma-plugin/manifest.json`.
2. Run **Plugins → Development → Tulpar**.
3. Press **Get a key on tulparsi.com**, sign in with GitHub, press **Connect Figma**, copy the key, and paste it into the plugin.
4. Select a frame and press **Generate component**.

## Publish it to the Figma Community

1. In the Figma desktop app: **Plugins → Development → New plugin…**. Choose **Figma design + Dev Mode**, name it **Tulpar**, and save it anywhere. Figma shows a new manifest with an `"id"`.
2. Copy that `"id"` into `figma-plugin/manifest.json` and commit it (done: 1694082041361272922).
3. Import `figma-plugin/manifest.json` (as above), then **Plugins → Development → Manage plugins in development → Tulpar → Publish**.
4. For the listing:
   - **Tagline:** Figma frames to verified code in your design system.
   - **Description:** Select a frame and Tulpar writes it with your team's design system (React, Vue, Angular, Svelte, Web Components or Flutter; Carbon, MUI, Chakra, Radix, shadcn/ui, PrimeNG, Element Plus, Shoelace, Material 3, or any design system on npm). It then builds, renders and checks the code against your frame before you see it: components, tokens, layout, text, pixels, tests and interaction states. Ask for changes in words, and they are checked again.
   - **Network access:** tulparsi.com, to generate and verify the component.
   - **Icon:** `figma-plugin/icon-128.png`.
   - **Support contact:** tulparsi.com/about.

Figma reviews new plugins, which usually takes a few days.
