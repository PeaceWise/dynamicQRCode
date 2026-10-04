# syntax=docker/dockerfile:1
# Works on x86_64 and ARM64 (e.g. Raspberry Pi): every stage uses the same
# multi-arch Node LTS base image, and native modules are built for the host CPU.

FROM node:24-bookworm-slim AS base
WORKDIR /app

# ---- All dependencies (compilers only needed if no prebuilt binary exists) ----
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- Compile TypeScript ----
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Test runner: docker build --target test -t dynamic-qr-test . && docker run --rm dynamic-qr-test ----
FROM build AS test
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY vitest.config.ts ./
COPY migrations ./migrations
COPY public ./public
COPY test ./test
CMD ["npm", "test"]

# ---- Production dependencies only ----
FROM deps AS prod-deps
RUN npm prune --omit=dev \
 && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
           node_modules/better-sqlite3/build/Release/obj* node_modules/better-sqlite3/build/Release/.deps \
           node_modules/better-sqlite3/build/Release/test_extension.node

# ---- Final, small runtime image ----
FROM base AS runtime
# Font used to print the URL text under the QR code in PNG downloads.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data \
 && chown node:node /data

ENV NODE_ENV=production \
    DATABASE_PATH=/data/qr.db \
    PORT=3000

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
