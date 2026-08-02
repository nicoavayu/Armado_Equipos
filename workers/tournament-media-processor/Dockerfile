# Arma2 Torneos · trusted Multimedia processing worker.
#
# Reproducible by construction: pinned base image, pinned sharp/libvips, ClamAV
# from the distribution with a freshclam run at build time. Nothing in this
# image talks to Staging or Production by itself — it reads SUPABASE_URL and a
# service credential from the environment at run time.
#
# Build:  docker build -t arma2/tournament-media-processor:0.1.0 .
# Run:    docker compose up   (see docker-compose.yml; brings up clamd too)

FROM node:22.14.0-bookworm-slim

# libvips is bundled with the sharp prebuilt; ClamAV is not, so it is installed
# and its definitions are fetched here. A build without definitions produces a
# worker whose antivirus self-test fails, which keeps uploadReady false.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    clamav-daemon clamav-freshclam ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Resource ceilings. libvips gets its own budget inside the process
# (see DEFAULT_LIMITS in src/codec.mjs); these bound the container itself.
ENV NODE_OPTIONS="--max-old-space-size=512" \
    UV_THREADPOOL_SIZE=2 \
    TOURNAMENT_MEDIA_CLAMD_HOST=clamd \
    TOURNAMENT_MEDIA_CLAMD_PORT=3310

USER node

CMD ["node", "src/index.mjs"]
