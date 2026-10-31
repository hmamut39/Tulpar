# syntax=docker/dockerfile:1.7-labs
# Tulpar web page, as a container. Build: docker build -t tulpar .
# Run:  docker run -p 8080:8080 --env-file .env -v tulpar-data:/app/data tulpar
#
# Needs at runtime: OPENAI_API_KEY and TULPAR_ACCESS_CODES (see .env.example); in production the
# server refuses to start without access codes. Hosting: fly.toml and docs/14-deploy.md.
# Figma data (the cache and the library read from it) lives in the /app/data volume.
#
# Layers go from what changes least to what changes most, and files are owned by "node" as they are
# written: a chown over the installed packages at the end would copy gigabytes into a new layer.

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=8080 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    TULPAR_FLUTTER_SDK=/opt/flutter TULPAR_DOTNET_ROOT=/opt/dotnet TULPAR_RUST_ROOT=/opt/rust DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 \
    PATH=/opt/flutter/bin:/opt/dotnet:$PATH

# System packages: git for Carbon's Code Connect files, and the typefaces design systems are drawn in.
# The render's network is blocked, so a design system's web fonts (Carbon's IBM Plex from IBM's CDN)
# never download; Carbon's @font-face tries local("IBM Plex Sans") first, so installed fonts are used.
# IBM Plex (Carbon), Roboto (Material UI), Inter and Open Sans (common in designs); all open licences.
# (Debian ships IBM Plex in its contrib section, which the base image does not enable.)
RUN sed -i 's/^Components: main$/Components: main contrib/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl xz-utils unzip libicu72 gcc libc6-dev \
      fonts-ibm-plex fonts-roboto fonts-inter fonts-open-sans \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/flutter /opt/dotnet /opt/rust && chown node:node /app /opt/flutter /opt/dotnet /opt/rust

# Tulpar's own dependencies: the manifests only, so a code change reuses this layer.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --parents core/package.json cli/package.json web/package.json mcp/package.json adapters/*/package.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npx playwright install --with-deps chromium \
 && chown -R node:node /app/node_modules

USER node

# The example projects (design systems the page offers), pinned by their lockfiles; only the manifests,
# so editing an example's config reuses its installed packages. --include=dev: the test tools.
COPY --chown=node:node --parents examples/*/package.json examples/*/package-lock.json ./
COPY --chown=node:node deploy/dedupe.mjs deploy/dedupe.mjs
RUN for d in examples/*/; do [ -f "$d/package-lock.json" ] || continue; (cd "$d" && npm ci --no-workspaces --ignore-scripts --include=dev --no-audit --no-fund); done \
 && node deploy/dedupe.mjs examples

# Flutter (Dart), for building and checking Flutter widgets: Google's release archive, its published
# SHA-256 checked, the web target only. Generated Dart is compiled here and runs only in Chromium.
ARG FLUTTER_VERSION=3.47.7
ARG FLUTTER_SHA256=af7455f540df951184c7953fbe3cf884766e7541dacf8571f9f582db03dd6230
RUN curl -sSL -o /tmp/flutter.tar.xz "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
 && echo "${FLUTTER_SHA256}  /tmp/flutter.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/flutter.tar.xz -C /opt && rm /tmp/flutter.tar.xz \
 && git config --global --add safe.directory /opt/flutter \
 && flutter --disable-analytics && dart --disable-analytics \
 && flutter config --no-enable-android --no-enable-ios --no-enable-linux-desktop --no-enable-macos-desktop --no-enable-windows-desktop \
 && flutter precache --web \
 && rm -rf /opt/flutter/examples /opt/flutter/dev/integration_tests /opt/flutter/dev/benchmarks /opt/flutter/dev/devicelab /opt/flutter/bin/cache/downloads \
 && rm -rf /opt/flutter/bin/cache/artifacts/engine/android-* /opt/flutter/bin/cache/artifacts/engine/linux-x64-profile /opt/flutter/bin/cache/artifacts/engine/linux-x64-release
# The Flutter example's packages and Tulpar's analyzer programs, fetched now: nothing downloads during a run.
COPY --chown=node:node --parents examples/flutter-material/pubspec.yaml examples/flutter-material/pubspec.lock adapters/flutter/tool/pubspec.yaml adapters/flutter/tool/pubspec.lock ./
RUN (cd examples/flutter-material && flutter pub get) && (cd adapters/flutter/tool && dart pub get)

# .NET, for building and checking Blazor components: Microsoft's release archive, its published SHA-512
# checked. Generated C# is compiled here and runs only in Chromium, as WebAssembly.
ARG DOTNET_VERSION=10.0.403
ARG DOTNET_SHA512=b7b3d8461cf98b07d2552ce9199702fa3ad010ac2671a5f8cd5136f7534e50f6855ba7bbb02b11494563f1d04156276a31cda1103b900e5eecd0d9473dc7b9c5
RUN curl -sSL -o /tmp/dotnet.tar.gz "https://builds.dotnet.microsoft.com/dotnet/Sdk/${DOTNET_VERSION}/dotnet-sdk-${DOTNET_VERSION}-linux-x64.tar.gz" \
 && echo "${DOTNET_SHA512}  /tmp/dotnet.tar.gz" | sha512sum -c - \
 && tar -xzf /tmp/dotnet.tar.gz -C /opt/dotnet && rm /tmp/dotnet.tar.gz \
 && rm -rf /opt/dotnet/sdk/*/FSharp /opt/dotnet/templates /opt/dotnet/sdk/*/Containers

# Rust, for building and checking Leptos components: rustup and wasm-bindgen from their releases, their
# published checksums checked. Generated Rust is compiled here (with no secrets in its environment) and
# runs only in Chromium, as WebAssembly. The example's crates are fetched now: a run compiles offline.
ARG RUST_VERSION=1.99.1
ARG RUSTUP_VERSION=1.29.2
ARG RUSTUP_SHA256=5be191e8c70a5007074254cb74d78dbfdd25cd5a61c27de7b8e5410122ec24f4
ARG WASM_BINDGEN_VERSION=0.2.130
ARG WASM_BINDGEN_SHA256=9687f3bb551b9f66f37ed32a40d7913a00f7962db653054e56857bc306c3227f
RUN curl -sSL -o /tmp/rustup-init "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
 && echo "${RUSTUP_SHA256}  /tmp/rustup-init" | sha256sum -c - && chmod +x /tmp/rustup-init \
 && CARGO_HOME=/opt/rust/cargo RUSTUP_HOME=/opt/rust/rustup /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" --target wasm32-unknown-unknown \
 && rm -rf /tmp/rustup-init /opt/rust/rustup/toolchains/*/share/doc /opt/rust/rustup/toolchains/*/share/man \
 && curl -sSL -o /tmp/wb.tgz "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
 && echo "${WASM_BINDGEN_SHA256}  /tmp/wb.tgz" | sha256sum -c - \
 && tar -xzf /tmp/wb.tgz -C /tmp && cp "/tmp/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl/wasm-bindgen" /opt/rust/cargo/bin/ && rm -rf /tmp/wb.tgz /tmp/wasm-bindgen-*

# Carbon's Code Connect files: the explicit Figma ↔ code links (public repository).
RUN git clone --depth 1 --filter=blob:none --sparse https://github.com/carbon-design-system/carbon.git .cache/repos/carbon \
 && git -C .cache/repos/carbon sparse-checkout set --no-cone '**/*.figma.ts' '**/*.figma.tsx'

COPY --chown=node:node . .

# What each framework's adapter writes, read now so a cold start does not have to start them all.
RUN node deploy/manifests.ts
# Flutter's widget index and theme, read now: an idle machine restarts and would lose them.
RUN node deploy/warm-flutter.ts
# The Blazor example's packages, components and theme, fetched and read now: nothing downloads during a run.
RUN (cd examples/blazor-mud && dotnet restore) && node deploy/warm-blazor.ts && rm -rf examples/blazor-mud/.tulpar/blazor/out
# The Leptos example's crates, compiled once: a run compiles only the generated component.
RUN (cd examples/leptos-thaw && CARGO_HOME=/opt/rust/cargo RUSTUP_HOME=/opt/rust/rustup /opt/rust/cargo/bin/cargo fetch --locked) && node deploy/warm-leptos.ts \
 && rm -rf examples/leptos-thaw/.tulpar/leptos/out /opt/rust/cargo/registry/cache \
 && rm -rf examples/leptos-thaw/.tulpar/leptos/target/*/debug/incremental examples/leptos-thaw/.tulpar/leptos/target/debug/incremental

# Figma data and outputs persist in a volume; the app expects them at .cache/figma and out/.
# deploy/start.sh prepares the volume as root, then runs the server as the "node" user.
RUN mkdir -p data/figma data/out && ln -s /app/data/figma .cache/figma && ln -s /app/data/out out && chmod +x deploy/start.sh

USER root
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["deploy/start.sh"]
