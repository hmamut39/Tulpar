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
    button.title = "Light or dark";
    button.innerHTML =
      '<span class="theme-track" aria-hidden="true"><i class="cloud c1"></i><i class="cloud c2"></i><i class="star s1"></i><i class="star s2"></i><i class="star s3"></i></span>' +
      '<span class="theme-knob" aria-hidden="true">' +
      '<svg class="theme-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
      '<svg class="theme-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>' +
      "</span>";
    const show = () => button.setAttribute("aria-checked", String(current() === "dark"));
    show();
    const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    button.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // private mode: the choice lasts for this page only
      }
      // The switch moves at once; the page follows, its new colours sweeping out from the switch in a circle.
      button.setAttribute("aria-checked", String(next === "dark"));
      const apply = () => {
        document.documentElement.dataset.theme = next;
      };
      if (!document.startViewTransition || still()) return apply();
      const r = button.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const t = document.startViewTransition(apply);
      t.ready
        .then(() => {
          document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, { duration: 550, easing: "cubic-bezier(.4, 0, .2, 1)", pseudoElement: "::view-transition-new(root)" });
        })
        .catch(() => {});
    });
    // Following the device until a choice is made: keep the switch in step if the device changes.
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      if (!saved()) show();
    });
    bar.append(button);
  });
})();
