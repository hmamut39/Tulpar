# Tulpar web page, as a container. Build: docker build -t tulpar .
# Run:  docker run -p 8080:8080 --env-file .env -v tulpar-data:/app/data tulpar
#
# Needs at runtime: OPENAI_API_KEY and TULPAR_ACCESS_CODE (see .env.example).
# Figma data (the cache and the library read from it) lives in the /app/data volume.

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=8080 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependencies first, for layer caching.
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY cli/package.json cli/
COPY web/package.json web/
COPY adapters/web-kit/package.json adapters/web-kit/
COPY adapters/web-components/package.json adapters/web-components/
COPY adapters/react/package.json adapters/react/
COPY adapters/angular/package.json adapters/angular/
RUN npm ci --omit=dev --ignore-scripts \
 && npx playwright install --with-deps chromium

# The example projects (design systems the page offers), pinned by their lockfiles.
COPY examples/ examples/
RUN for d in examples/*/; do (cd "$d" && npm ci --no-workspaces --ignore-scripts); done

# Carbon's Code Connect files: the explicit Figma ↔ code links (public repository).
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
 && git clone --depth 1 --filter=blob:none --sparse https://github.com/carbon-design-system/carbon.git .cache/repos/carbon \
 && git -C .cache/repos/carbon sparse-checkout set --no-cone '**/*.figma.ts' '**/*.figma.tsx'

COPY . .

# Figma data and outputs persist in a volume; the app expects them at .cache/figma and out/.
RUN mkdir -p data/figma data/out && ln -s /app/data/figma .cache/figma && ln -s /app/data/out out \
 && chown -R node:node /app
USER node

EXPOSE 8080
CMD ["node", "web/src/server.ts"]
