# Arma2 Torneos · signer attestation renewer.
#
# This package had no container image, which is why it is added here: the
# Staging manifest in ops/torneos-staging/media-runtime/ runs the renewer as a
# sidecar and cannot do so without one. Nothing in the package itself changes.
#
# The image deliberately carries NO service credential and no way to obtain one.
# `src/config.mjs` refuses to start if the gateway credential looks privileged
# (RENEWER_GATEWAY_KEY_PRIVILEGED), so the "holds no service credential" claim
# is enforced at run time rather than asserted here.
#
# Build:  docker build -t arma2/tournament-media-signer-renewer:0.1.0 .

FROM node:22.14.0-bookworm-slim

WORKDIR /app

# The package declares no runtime dependencies. `npm ci` still runs, because it
# is what fails when package.json and package-lock.json disagree — a dependency
# appearing here later should break the build, not be installed silently.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src

# The renewal loop is a timer and one HTTPS request; it needs neither heap nor
# threads. Small ceilings make an unexpected appetite visible immediately.
ENV NODE_OPTIONS="--max-old-space-size=96" \
    UV_THREADPOOL_SIZE=1

USER node

# Loop mode. `--once` is for an external scheduler and needs a writable state
# file, which the Staging manifest deliberately does not mount.
CMD ["node", "src/cli.mjs"]
