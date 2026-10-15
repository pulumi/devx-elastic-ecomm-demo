# Build context is the repo root (npm workspaces need the root
# package-lock.json and sibling workspace package.json files present).
# docker build -f apps/api/Dockerfile .

FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# better-sqlite3 needs a prebuilt binary for this platform, or these to
# compile one from source — keeps `npm ci` working on any build host/arch.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/deploy-hook/package.json apps/deploy-hook/package.json
COPY apps/traffic-gen/package.json apps/traffic-gen/package.json
COPY apps/content-cli/package.json apps/content-cli/package.json
COPY apps/friction-report/package.json apps/friction-report/package.json
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .
RUN npm run build -w apps/api

FROM node:20-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/packages ./packages

RUN mkdir -p /data
ENV DATABASE_PATH=/data/shopfront.sqlite

EXPOSE 8787
CMD ["node", "apps/api/dist/server.js"]
