# Blazor (C#)

C# joins through Blazor, with MudBlazor as the first design system (`examples/blazor-mud`). Same rules as every framework: the design system's own components and tokens, built, rendered and checked against the design, and generated code that runs only in the sandboxed browser.

```
SignInCard.razor       the component, with any logic in @code
SignInCard.razor.css   Razor scoped CSS for its own layout
```

| Part | How |
|---|---|
| **Adapter** | `adapters/blazor`, a TypeScript program speaking the same protocol. It calls the .NET SDK as a tool. |
| **Index** | `adapters/blazor/tool`: reads the package's compiled metadata (MetadataLoadContext) without running it. `[Parameter]`s become props, `RenderFragment`s slots, `EventCallback`s events. MudBlazor: 171 components. |
| **Tokens** | MudBlazor writes its theme as CSS variables when it starts, so they are read from a rendered page (`--mud-palette-*`, `--mud-typography-*`): 212 tokens. |
| **Build** | A small harness app (`.tulpar/blazor`) with the project's own package versions, published to static files. An unknown component is an error (RZ10012), and errors name the file and line. |
| **Render** | Blazor draws real HTML, so Tulpar's usual render applies. WebAssembly cannot load from a file, so the adapter serves the site on localhost for the render, and every other host stays blocked. |
| **Component identity** | A Blazor component leaves no trace in the DOM, so the source says which component each `data-figma-id` is written on. Controls that pass the id to an inner `<input>` are measured by their root (`roots` in `tulpar.json`). |
| **Tests** | Not checked. bUnit, the usual library, runs the component on the host, and generated code must run only in the sandbox. Running tests in the browser is the open item. |

The .NET SDK is in the server image, its published SHA-512 checked. Locally, install it and set `TULPAR_DOTNET_ROOT` (or put `dotnet` on the PATH), then run `dotnet restore` in the example.

**Next languages:** see `docs/19-leptos.md`. SwiftUI needs a Mac to build on.
