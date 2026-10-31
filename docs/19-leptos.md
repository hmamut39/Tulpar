# Leptos (Rust)

Rust joins through Leptos, with Thaw as the first design system (`examples/leptos-thaw`). Same rules as every framework: the design system's own components and tokens, built, rendered and checked against the design, and generated code that runs only in the sandboxed browser.

```
sign_in_card.rs    the component: #[component] pub fn SignInCard() -> impl IntoView
sign_in_card.css   plain CSS for its own layout
```

| Part | How |
|---|---|
| **Adapter** | `adapters/leptos`, a TypeScript program speaking the same protocol. It calls cargo and wasm-bindgen as tools. |
| **Index** | Read from the crate's source, as cargo fetched it: a `#[component]` function's arguments are its props, `Children` slots, callbacks events, and `pub enum`s give the values. Thaw: 133 components. |
| **Tokens** | Thaw writes its theme as CSS variables on `.thaw-config-provider`, read from a rendered page: 161 tokens. |
| **Build** | A small harness crate (`.tulpar/leptos`) with the project's dependencies at its `Cargo.lock` versions, compiled to `wasm32-unknown-unknown` and packaged by wasm-bindgen. Its compile output is kept, so only the component recompiles. |
| **Render** | Leptos draws real HTML, so Tulpar's usual render applies, through a site served on localhost with every other host blocked. |
| **Tests** | Not checked yet: running `wasm-bindgen-test` in the sandboxed browser is the open item. |

## Compiling is not harmless in Rust

Rust can read files and the environment *while it compiles* (`include_str!`, `env!`), and whatever it reads could end up in the picture a person gets back. A design can influence what the model writes, so:

- cargo runs with a bare environment: no secrets.
- Source that uses `include!`, `include_str!`, `include_bytes!`, `env!`, `option_env!`, `#[path]`, `mod x;`, `extern`, `unsafe`, `macro_rules!`, `std::fs`, `std::net` or `std::process` is refused before it is compiled.
- cargo runs with `--offline`, on dependencies fixed by the project's lockfile.

## Why not Java or Python yet

Vaadin (Java) and NiceGUI or Reflex (Python) run the component on the server, and generated code must run only in the sandboxed browser. They need each check to run on a separate throwaway machine with no secrets and no network.
