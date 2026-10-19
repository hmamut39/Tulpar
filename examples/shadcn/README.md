# shadcn/ui example

A Vite + React app set up with the shadcn CLI (`shadcn init`, then `shadcn add button card input label checkbox badge separator`). The components live in the project's own source, `src/components/ui`, and its Tailwind theme is `src/index.css`.

`tulpar.json` tells Tulpar's React adapter:

- `sources`: index `src/components/ui`; code imports each file as `@/components/ui/{file}`.
- `tailwind`: compile Tailwind with `src/index.css`, so its colour classes (`bg-primary`, `text-muted-foreground`), spacing scale and radii are the design system. Code styles with Tailwind classes; literal values (`bg-[#…]`, `p-[13px]`) fail the token checks.
- `tokens.css`: the CSS variables in `src/index.css`, light on `:root` and dark on `.dark`.
