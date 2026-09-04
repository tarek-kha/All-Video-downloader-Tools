FROM node:22-slim

# System deps: python3/pip for yt-dlp, ffmpeg for media validation/merging,
# unzip/curl for the Deno installer, git + canvas build deps for the
# optional YouTube PO-token provider below.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg curl unzip git ca-certificates \
    build-essential pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Deno — yt-dlp's recommended JS runtime for solving modern YouTube
# JS challenges (EJS). Falls back gracefully if unavailable; Node 22+
# above is the secondary supported runtime.
RUN curl -fsSL https://deno.land/install.sh | sh -s -- -y \
    && ln -s /root/.deno/bin/deno /usr/local/bin/deno

# yt-dlp[default] (includes yt-dlp-ejs) + curl_cffi (Chrome TLS
# impersonation), in an isolated venv to avoid Debian's
# externally-managed-environment restriction.
# PINNED to a stable release on purpose: --pre nightlies ship broken
# extractors (e.g. OK.ru broke with "the JSON object must be str..." in
# the 2026.08.27+ nightlies). Bump this version manually when a newer
# stable is released.
RUN python3 -m venv /opt/ytdlp-venv \
    && /opt/ytdlp-venv/bin/pip install --no-cache-dir "yt-dlp[default]==2026.8.19" curl_cffi \
    && ln -s /opt/ytdlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp

# OPTIONAL: YouTube PO-Token provider (bgutil-ytdlp-pot-provider, script
# mode). yt-dlp only calls this when its own logic decides a specific
# client/format actually requires a proof-of-origin token — normal public,
# no-cookie extraction is completely unaffected and always tried first.
#
# BGUTIL_POT_VERSION is the SINGLE source of truth: it pins the git tag
# cloned/built below AND the exact pip plugin version installed, and is
# exported as PO_PROVIDER_VERSION so app/lib/health.ts's runtime check can
# confirm the installed plugin actually matches the built server script
# instead of silently drifting apart.
#
# Best-effort: if this step fails for any reason (network hiccup, native
# `canvas` build issue, etc.) the build continues WITHOUT it rather than
# failing the whole deploy, since it's a fallback, not a requirement.
ARG BGUTIL_POT_VERSION=1.3.2
ENV PO_PROVIDER_VERSION=${BGUTIL_POT_VERSION}
RUN ( git clone --depth 1 --branch ${BGUTIL_POT_VERSION} https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /root/bgutil-ytdlp-pot-provider \
      && cd /root/bgutil-ytdlp-pot-provider/server \
      && npm ci \
      && npx tsc \
      && /opt/ytdlp-venv/bin/pip install --no-cache-dir "bgutil-ytdlp-pot-provider==${BGUTIL_POT_VERSION}" ) \
    || echo "WARN: optional YouTube PO-token provider setup failed — continuing without it (public extraction is unaffected)"

# This app always runs behind exactly one trusted reverse proxy in
# production (Render's own edge load balancer), so it's safe to trust the
# X-Forwarded-For entry that hop appends. Local/dev runs without this env
# var default to NOT trusting forwarded headers (see lib/security/rate-limit.ts).
ENV TRUST_PROXY=true
ENV TRUSTED_PROXY_HOPS=1

WORKDIR /app

# Install with devDependencies included (NODE_ENV NOT set yet — setting it
# to "production" before `npm install` would make npm skip the
# typescript/tailwind/etc. devDependencies that the build step needs).
COPY package.json package-lock.json* ./
RUN npm install

# NOW switch to production — required for `next build` itself (an unset/
# non-standard NODE_ENV during the build step caused a build error in
# testing), and also correct for the runtime `next start`.
ENV NODE_ENV=production

COPY . .
RUN npm run build

# Build-time verification: fail the image build immediately if the yt-dlp
# binary or its venv Python interpreter is missing or broken. This is cheap
# (offline --version flag, no network traffic) and ensures a broken yt-dlp
# can never reach production silently.
RUN yt-dlp --version

EXPOSE 3000

CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
