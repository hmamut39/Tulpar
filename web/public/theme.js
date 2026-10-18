// Light or dark, on every page: a sliding switch in the top bar. Until the visitor uses it, the page
// follows the device's setting; their choice is remembered. Loaded in <head> so the theme applies
// before the page is drawn.
(() => {
  const KEY = "tulpar.theme";
  const device = () => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const saved = () => {
    try {
      const t = localStorage.getItem(KEY);
      return t === "light" || t === "dark" ? t : undefined;
    } catch {
      return undefined;
    }
  };
  const current = () => saved() ?? device();
  // Only an explicit choice is written on the page; otherwise the CSS follows the device.
  if (saved()) document.documentElement.dataset.theme = saved();

  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".nav-links") ?? document.querySelector(".nav-inner");
    if (!bar) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-switch";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-label", "Dark mode");
    button.innerHTML =
      '<svg class="theme-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
      '<svg class="theme-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>' +
      '<span class="theme-knob" aria-hidden="true"></span>';
    const show = () => button.setAttribute("aria-checked", String(current() === "dark"));
    show();
    button.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // private mode: the choice lasts for this page only
      }
      document.documentElement.dataset.theme = next;
      show();
    });
    // Following the device until a choice is made: keep the switch in step if the device changes.
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      if (!saved()) show();
    });
    bar.append(button);
  });
})();
