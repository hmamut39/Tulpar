# Going live

How Tulpar's web page runs in production, and the steps to put it online. Only the owner can
do the steps marked **you**: each one needs an account, a payment card or a secret.

## What production adds (2026-10-10)

| Rule | Why |
|---|---|
| **Invite codes** (`TULPAR_ACCESS_CODES=a,b,c`), one per tester | Every run spends the owner's OpenAI key. A code can be revoked without touching the others. The usage log records which invite ran a job (as a short hash, never the code). |
| **Refuses to start** with `NODE_ENV=production` and no codes | An open page by accident is a bill by accident. `TULPAR_PUBLIC=1` opens it on purpose. |
| **Daily cap** for the whole server (`TULPAR_RUNS_PER_DAY`, default 100) and a queue limit (20) | Bounds the OpenAI cost per day, whatever happens. Each visitor also has an hourly limit (`TULPAR_RUNS_PER_HOUR`, default 10). |
| **Trusted proxy only** (`TULPAR_TRUST_PROXY=1`) | Otherwise anyone could fake `X-Forwarded-For` to escape the per-visitor limit. Behind the proxy, the last entry (the one the proxy added) is used. |
| **Security headers** | CSP (own files and Google Fonts only), no framing, no referrer, HSTS in production. |
| **`/healthz`** | For the platform's health checks and the Docker `HEALTHCHECK`. |
| **Graceful shutdown** | On a deploy (SIGTERM), the server stops taking requests and lets the running generation finish (up to 2 minutes). |
| **One JSON log line per job** | Project, source (Figma, screenshot or both), status, attempts, tokens, time, invite. Never the Figma token, the image, the code or the files. Enough to see who uses it and what it costs. |
| **Library seed** (`deploy/seed/library.json`) | The Carbon Figma library Tulpar matched against, shipped with the image and copied onto the data volume. Without it, Figma components could only be mapped through Code Connect links. Refresh it after `tulpar library` reads more pages. |

CI (`.github/workflows/ci.yml`) runs the typecheck and tests on every push. It also builds the
production image and checks two things: the image refuses to start without codes, and with codes
it serves the page, the health check and the security headers, with the library seeded.

## Hosting: Fly.io

**Why Fly.io:** one small machine with a disk, Docker as-is, HTTPS and custom domains included,
deploys from GitHub. Each job renders in Chromium, so the machine needs 2 GB of memory.
It stops when nobody is connected.

| | Monthly cost (approx.) |
|---|---|
| shared-cpu-2x, 2 GB, running all day | about $11 (less while it is stopped) |
| 3 GB volume | about $0.45 |
| OpenAI | depends on use: the daily cap bounds it |

Render or Railway would also work (Dockerfile, a disk, `/healthz`), at a similar or higher price.

## Steps

1. **You:** create a Fly.io account (fly.io, a card is required) and install `flyctl`
   (Windows: `pwsh -c "iwr https://fly.io/install.ps1 -useb | iex"`), then run `fly auth login`.
2. In the repository folder (I can run these once you are logged in):
   ```sh
   fly launch --no-deploy --copy-config --name tulpar   # pick another name if "tulpar" is taken
   fly volumes create tulpar_data --size 3 --region iad
   fly secrets set OPENAI_API_KEY=sk-... TULPAR_ACCESS_CODES=invite-for-alice,invite-for-bob
   fly deploy
   ```
   The page is then at `https://tulpar.fly.dev` (or your app name).
3. **Automatic deploys:** run `fly tokens create deploy -x 999999h`, and add the token to GitHub
   as the `FLY_API_TOKEN` secret (repository → Settings → Secrets and variables → Actions).
   From then on, every push to `main` that passes CI deploys itself (`.github/workflows/deploy.yml`).
4. **Domain:**
   - **You:** buy the domain.
   - Run `fly certs add <domain>` and `fly certs add www.<domain>`.
   - **You:** add the DNS records it prints at your registrar.
   - HTTPS is issued automatically.

## Domain

Checked on 2026-10-10 with RDAP, the registries' public lookup:

- **tulparai.com: taken.** Registered on 2025-09-22 at Natro, a Turkish registrar, and renewed until 2027-09-22. It has no website. You could ask the owner through Natro's WHOIS contact, but a domain someone renewed recently is usually expensive or not for sale.
- **tulpar.ai:** registered and parked for sale (Afternic).
- **Not registered:**
  - tulparai.dev, tulparai.io, tulparai.app, tulparai.co, tulparai.net, tulparai.tech;
  - tulpar-ai.com, gettulpar.com, usetulpar.com, tulparhq.com, trytulpar.com, tulparcode.com;
  - tulpar.design.

  Availability can still change, and some may be priced as premium.

**Recommendation: tulparai.dev.**
- It reads exactly as "Tulpar AI" and says "for developers".
- Browsers only open .dev sites over HTTPS, which suits a tool that handles tokens.
- It costs about $12–15 a year (Cloudflare Registrar sells at cost).
- tulparai.io is the alternative. If you later want a .com as well, buy tulpar-ai.com and redirect it.

Before buying, check the trademark: "Tulpar" is a common name in Turkey and Central Asia
(Otokar's "Tulpar" armoured vehicle, and several companies). Search USPTO (tmsearch.uspto.gov),
EUIPO and TÜRKPATENT for software classes (9 and 42).

## Launch stages

1. **Private beta (now, once hosted):** 5–10 invited front-end developers, one code each. Watch the log lines and ask for feedback weekly.
2. **Public beta:** after bring-your-own design system (G9), the CI check and the eval benchmark, so people outside can use their own library. Add sign-up instead of codes.
3. **1.0:** pricing, terms and privacy policy, and support for teams.
