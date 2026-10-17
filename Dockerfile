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
ENV NODE_ENV=production PORT=8080 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# System packages: git for Carbon's Code Connect files, and the typefaces design systems are drawn in.
# The render's network is blocked, so a design system's web fonts (Carbon's IBM Plex from IBM's CDN)
# never download; Carbon's @font-face tries local("IBM Plex Sans") first, so installed fonts are used.
# IBM Plex (Carbon), Roboto (Material UI), Inter and Open Sans (common in designs); all open licences.
# (Debian ships IBM Plex in its contrib section, which the base image does not enable.)
RUN sed -i 's/^Components: main$/Components: main contrib/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
      fonts-ibm-plex fonts-roboto fonts-inter fonts-open-sans \
 && rm -rf /var/lib/apt/lists/* \
 && chown node:node /app

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
RUN for d in examples/*/; do (cd "$d" && npm ci --no-workspaces --ignore-scripts --include=dev --no-audit --no-fund); done

# Carbon's Code Connect files: the explicit Figma ↔ code links (public repository).
RUN git clone --depth 1 --filter=blob:none --sparse https://github.com/carbon-design-system/carbon.git .cache/repos/carbon \
 && git -C .cache/repos/carbon sparse-checkout set --no-cone '**/*.figma.ts' '**/*.figma.tsx'

COPY --chown=node:node . .

# What each framework's adapter writes, read now so a cold start does not have to start them all.
RUN node deploy/manifests.ts

# Figma data and outputs persist in a volume; the app expects them at .cache/figma and out/.
# deploy/start.sh prepares the volume as root, then runs the server as the "node" user.
RUN mkdir -p data/figma data/out && ln -s /app/data/figma .cache/figma && ln -s /app/data/out out && chmod +x deploy/start.sh

USER root
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["deploy/start.sh"]
