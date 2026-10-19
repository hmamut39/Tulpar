// Tulpar for Figma: the selected frame, exported as a picture, becomes a verified component on
// tulparsi.com. This side reads the selection and keeps the key; the panel (ui.html) talks to the server.

figma.showUI(__html__, { width: 420, height: 640, themeColors: true, title: "Tulpar" });

const KEY = "tulpar.key";
const SERVER = "tulpar.server";
// Pictures larger than this on their long side are sent at 1×: the server takes up to 8 MB.
const MAX_SIDE = 4096;

/** A component name from a layer name: "Sign in / card" → SignInCard. */
function componentName(layer) {
  const words = String(layer).replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("").slice(0, 64);
  if (!name) return "Component";
  return /^[0-9]/.test(name) ? `Frame${name}`.slice(0, 64) : name;
}

function selected() {
  const nodes = figma.currentPage.selection;
  if (nodes.length !== 1) return { error: nodes.length ? "Select one frame at a time." : "Select a frame, component or section to generate." };
  const node = nodes[0];
  if (!("exportAsync" in node) || !("width" in node)) return { error: "That layer cannot be exported. Select a frame, component or group." };
  if (node.width < 8 || node.height < 8) return { error: "That layer is too small to generate." };
  return { node };
}

function describeSelection() {
  const { node, error } = selected();
  figma.ui.postMessage(error ? { type: "selection", error } : { type: "selection", layer: node.name, name: componentName(node.name), width: Math.round(node.width), height: Math.round(node.height) });
}

figma.on("selectionchange", describeSelection);

figma.ui.onmessage = async (message) => {
  switch (message.type) {
    case "ready": {
      const [key, server] = await Promise.all([figma.clientStorage.getAsync(KEY), figma.clientStorage.getAsync(SERVER)]);
      figma.ui.postMessage({ type: "settings", key: key || "", server: server || "https://tulparsi.com" });
      describeSelection();
      break;
    }
    case "save-key":
      await figma.clientStorage.setAsync(KEY, String(message.key || ""));
      break;
    case "save-server":
      await figma.clientStorage.setAsync(SERVER, String(message.server || ""));
      break;
    case "open":
      if (/^https:\/\/tulparsi\.com\//.test(message.url) || /^http:\/\/localhost:4173\//.test(message.url)) figma.openExternal(message.url);
      break;
    case "notify":
      figma.notify(String(message.text).slice(0, 200), { error: !!message.error });
      break;
    case "export": {
      const { node, error } = selected();
      if (error) return figma.ui.postMessage({ type: "export-failed", error });
      const scale = Math.max(node.width, node.height) * 2 > MAX_SIDE ? 1 : 2;
      try {
        const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
        figma.ui.postMessage({ type: "image", bytes, scale, name: componentName(node.name) });
      } catch (err) {
        figma.ui.postMessage({ type: "export-failed", error: `Figma could not export the layer: ${err && err.message ? err.message : err}` });
      }
      break;
    }
  }
};
