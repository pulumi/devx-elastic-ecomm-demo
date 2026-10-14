# Build context is the repo root. docker build -f apps/traffic-gen/Dockerfile .
# The Playwright base image ships Chromium and its system libraries, pinned
# to the same version as the playwright dependency.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /repo
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/deploy-hook/package.json apps/deploy-hook/package.json
COPY apps/traffic-gen/package.json apps/traffic-gen/package.json
COPY apps/content-cli/package.json apps/content-cli/package.json
COPY apps/friction-report/package.json apps/friction-report/package.json
RUN npm ci --workspace apps/traffic-gen --include-workspace-root=false

COPY apps/traffic-gen apps/traffic-gen
WORKDIR /repo/apps/traffic-gen
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
