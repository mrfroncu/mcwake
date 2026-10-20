# The whole of mcwake on the home server: one Node process, no Python, no
# Docker socket. Build context is this directory.
FROM node:24-trixie-slim AS builder
WORKDIR /app
# better-sqlite3 falls back to compiling itself when no prebuilt binary fits.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# openssh-client: the host is powered off over SSH (clients/host.ts).
# Debian publishes security fixes before the next base image, so take them here.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends openssh-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
# Unprivileged: nothing here needs root. /data is the state volume.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 7100
CMD ["node", "dist/index.js"]
