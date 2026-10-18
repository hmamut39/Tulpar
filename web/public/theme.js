// Light, dark or auto (the device's setting), on every page. Loaded in <head> so the chosen theme
// applies before the page is drawn; the toggle is added to the top bar once the page has loaded.
(() => {
  const KEY = "tulpar.theme";
  const ORDER = ["auto", "light", "dark"];
  const LABELS = { auto: "Theme: auto (follows your device)", light: "Theme: light", dark: "Theme: dark" };
  const ICONS = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
  };
  const read = () => {
    try {
      const t = localStorage.getItem(KEY);
      return ORDER.includes(t) ? t : "auto";
    } catch {
      return "auto";
    }
  };
  const apply = (theme) => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  };
  apply(read());

  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".nav-links") ?? document.querySelector(".nav-inner");
    if (!bar) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    const show = (theme) => {
      button.innerHTML = ICONS[theme];
      button.setAttribute("aria-label", LABELS[theme]);
      button.title = LABELS[theme];
    };
    show(read());
    button.addEventListener("click", () => {
      const next = ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length];
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // private mode: the choice lasts for this page only
      }
      apply(next);
      show(next);
    });
    bar.append(button);
  });
})();
