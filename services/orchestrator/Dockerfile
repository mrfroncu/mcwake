# Build context is the repo root (see docker-compose.yml) so this stage can
# see the npm workspaces layout and build the shared @mcwake/common package.
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY services/common/package.json services/common/package.json
COPY services/orchestrator/package.json services/orchestrator/package.json
COPY services/idle-reaper/package.json services/idle-reaper/package.json
COPY services/web/package.json services/web/package.json
RUN npm install

COPY tsconfig.base.json ./
COPY services/common services/common
COPY services/orchestrator services/orchestrator
RUN npm run build -w services/common -w services/orchestrator

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Python + python-kasa for Tapo control (services/common/tapo/) — see
# tapo/requirements.txt for why this is Python and not native TS.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/services/common/tapo ./services/common/tapo
RUN pip install --no-cache-dir --break-system-packages -r services/common/tapo/requirements.txt

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/services/common/dist ./services/common/dist
COPY --from=builder /app/services/common/package.json ./services/common/package.json
COPY --from=builder /app/services/orchestrator/dist ./services/orchestrator/dist
COPY --from=builder /app/services/orchestrator/package.json ./services/orchestrator/package.json
EXPOSE 7100
CMD ["node", "services/orchestrator/dist/index.js"]
