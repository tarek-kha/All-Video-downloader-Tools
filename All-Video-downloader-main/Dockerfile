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

# yt-dlp installed from the GitHub MASTER branch (tarball — plain HTTPS
# download, no git needed) — the current, strongest version: brand-new
# extractor fixes for ALL sites land here first (weeks before they reach a
# stable release). yt-dlp[default] includes yt-dlp-ejs (JS challenge
# solving) + curl_cffi (Chrome TLS impersonation). Installed in an isolated
# venv to avoid Debian's externally-managed-environment restriction.
# Rebuilt fresh on every deploy, so the site always runs the newest code.
RUN python3 -m venv /opt/ytdlp-venv \
    && /opt/ytdlp-venv/bin/pip install --no-cache-dir "yt-dlp[default] @ https://github.com/yt-dlp/yt-dlp/archive/refs/heads/master.tar.gz" \
    && ln -s /opt/ytdlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp

# TEMPORARY WORKAROUND for yt-dlp issue #17585: OK.ru changed their site and
# now sends flashvars.metadata already JSON-parsed (a dict), which crashes
# the extractor with "the JSON object must be str, bytes or bytearray, not
# dict". Skip the second parse when metadata is already a dict. Best-effort:
# once upstream fixes it, this patch silently no-ops. (Patch verified against
# master + stable 2026.08.19: applies cleanly and compiles.)
RUN /opt/ytdlp-venv/bin/python -c "import glob; m=glob.glob('/opt/ytdlp-venv/lib/python3*/site-packages/yt_dlp/extractor/odnoklassniki.py'); p=m[0]; s=open(p).read(); old='        if metadata:\n            metadata = self._parse_json(metadata, video_id)'; new='        if metadata:\n            if isinstance(metadata, str):\n                metadata = self._parse_json(metadata, video_id)'; open(p,'w').write(s.replace(old,new)) if old in s else print('WARN: ok.ru patch skipped (already fixed upstream?)')"

# OPTIONAL: YouTube PO-Token provider (bgutil-ytdlp-pot-provider, script
# mode — yt-dlp invokes the built script directly; no always-on server).
# yt-dlp only calls this when its own logic decides a specific client/format
# actually requires a proof-of-origin token — normal public, no-cookie
# extraction is completely unaffected and always tried first.
#
# v2.0.0: fixes RCE advisory GHSA-qpv9-8xfj-xx9m (server-binding issue;
# we use script mode, but stay current anyway). BGUTIL_POT_VERSION is the
# SINGLE source of truth: it pins the downloaded server tag AND the exact
# pip plugin version, and is exported as PO_PROVIDER_VERSION so
# app/lib/health.ts's runtime check can confirm both match instead of
# silently drifting apart.
#
# Robustness changes vs the old version: tarball download instead of git
# clone (git protocol is flaky in some build networks), and numbered echo
# markers so the exact failing step is visible in the build log.
#
# Best-effort: if any step fails (network hiccup, native `canvas` build
# issue, etc.) the build continues WITHOUT it rather than failing the whole
# deploy, since it's a fallback, not a requirement.
ARG BGUTIL_POT_VERSION=2.0.0
ENV PO_PROVIDER_VERSION=${BGUTIL_POT_VERSION}
RUN echo "[pot] 1/4 download server ${BGUTIL_POT_VERSION}"       && curl -fsSL -o /tmp/pot-provider.tar.gz "https://codeload.github.com/Brainicism/bgutil-ytdlp-pot-provider/tar.gz/refs/tags/${BGUTIL_POT_VERSION}"       && mkdir -p /root/bgutil-ytdlp-pot-provider       && tar xzf /tmp/pot-provider.tar.gz -C /root/bgutil-ytdlp-pot-provider --strip-components=1       && echo "[pot] 2/4 npm ci (native canvas build)"       && cd /root/bgutil-ytdlp-pot-provider/server       && npm ci --no-audit --no-fund       && echo "[pot] 3/4 tsc transpile"       && npx tsc       && echo "[pot] 4/4 pip plugin ${BGUTIL_POT_VERSION}"       && /opt/ytdlp-venv/bin/pip install --no-cache-dir "bgutil-ytdlp-pot-provider==${BGUTIL_POT_VERSION}"       && echo "[pot] setup complete"     || echo "WARN: optional YouTube PO-token provider setup failed — continuing without it (public extraction is unaffected)"

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
