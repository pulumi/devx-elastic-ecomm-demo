# Build context is the repo root. docker build -f apps/web/Dockerfile .

FROM node:20-bookworm-slim AS builder
WORKDIR /repo

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
# Optional: enables Elastic RUM in the built bundle.
ARG VITE_ELASTIC_APM_SERVER_URL=""
ENV VITE_ELASTIC_APM_SERVER_URL=$VITE_ELASTIC_APM_SERVER_URL
RUN npm run build -w apps/web

FROM nginx:1.27-alpine
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
# Only API_UPSTREAM is substituted, so nginx's own $variables are left alone.
ENV API_UPSTREAM=api:8787
ENV NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
EXPOSE 80
