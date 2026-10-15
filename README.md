# Shopfront

An eCommerce storefront built on Vite + React, with Elastic Cloud as the
observability/security backbone for classifying traffic as human vs
bot/agent.

## Status

| Workstream | Status |
| --- | --- |
| Infra | Done — one Pulumi program (`infra/pulumi`, stack `demo`): Elastic pipeline/templates/dashboards + shop on ECS Fargate + scheduled traffic generator. Validated locally; not yet applied |
| API contract & seed data | Done — `packages/contracts` |
| Product & Order API | Done — catalog, cart, checkout, order history, admin catalogue endpoints, tested |
| Storefront UI | Done — full flow wired to the API |
| Elastic instrumentation | Done — every API request and HTML page fetch writes a `traffic-classification-*` doc; friction events to `shop-friction-*`; lifecycle events to `user-lifecycle-events-*` |
| Traffic classification | Done (rule-based) — `elastic/pipelines`, runs as the templates' default pipeline; scored against synthetic ground truth |
| Traffic generator | Done — `apps/traffic-gen`: browser humans and scripted AI agents. LLM agents are coded but off until an inference provider is wired up |
| Content tool | Done — `apps/content-cli` |
| Jina friction analysis | Done — `apps/friction-report` (Elastic-hosted Jina reranker + embeddings) |
| Coding-harness deploy webhook | Done, untested against a live target — `apps/deploy-hook` |

## Agent-vs-human demo quickstart

```sh
npm install && (cd infra/pulumi && npm install)
cd infra/pulumi && pulumi stack select demo && pulumi preview && pulumi up && cd ../..
npm run content -- generate --count 24 --replace       # stock the shop (URL + key come from the stack)
npm run traffic -- --target "$(pulumi -C infra/pulumi stack output shopUrl)" --humans 3 --agents 12
ELASTICSEARCH_URL=... ELASTICSEARCH_API_KEY=... npm run friction -- --window 24h
pulumi -C infra/pulumi stack output kibanaDashboards  # the two Kibana dashboards
```

The shop is deliberately left as-is: the point is to *surface* where agents struggle, not to fix it yet.

## Repo layout

```
apps/web             Vite + React storefront; nginx mirrors page fetches to the API tracker
apps/api             Fastify API (storefront, /internal insights/friction/products, traffic tagging)
apps/traffic-gen     Synthetic shoppers (Playwright humans, scripted agents, LLM agents)
apps/content-cli     Catalogue import/export/seed/generate
apps/friction-report Jina-ranked agent friction report (markdown)
apps/deploy-hook     Webhook a coding harness calls to submit a git ref for CI-gated Docker+SSH deploy
packages/contracts   OpenAPI spec, seed data, index templates
infra/pulumi         Pulumi program: Elastic setup + AWS shop + traffic schedule
elastic/             Classification ingest pipeline
demo/                AppleScript browser scenes for the demo video
```

## Local development

The API uses SQLite by default (zero external services) so the storefront
runs with nothing but Node installed. `docker-compose.yml` (Postgres + Redis)
is there for when the API migrates to Postgres — it
isn't wired up yet.

### One command

```bash
npm start   # or: ./scripts/dev.sh
```

Installs dependencies on first run, starts the API and the web app, waits
for both to be healthy, opens http://localhost:5173 in your browser, and
tears everything down cleanly on Ctrl-C. Logs land in `.dev-logs/`. Override
ports with `PORT` (API) / `WEB_PORT` (web) env vars if 8787/5173 are taken.

### Or run them separately

```bash
npm install
npm run dev:api    # http://localhost:8787
npm run dev:web    # http://localhost:5173 (proxies /api to the API above)
```

Open http://localhost:5173 — browse the catalog, add to cart, check out with
any email, then look it up on the Orders page.

### Tests / build

```bash
npm test    # all three apps
npm run build   # all three apps
```

## Coding harness hooks

Three endpoints let a coding agent close the loop between "what's the
traffic data telling us" and "ship a fix for it":

- **`GET /internal/insights`** (on `apps/api`, port 8787) — bearer-token auth
  via `INTERNAL_API_KEY`. Returns the traffic-classification breakdown
  (human / bot-suspected / bot-confirmed / agent-known / agent-suspected) and
  the lifecycle funnel (session_start → product_viewed → added_to_cart →
  checkout_started → order_completed) over a time window, so an agent can see
  where agent/bot traffic is dropping off differently from human traffic
  before deciding what to build. Returns `elasticConfigured: false` until a
  real Elastic Cloud deployment exists.

  ```bash
  curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
    "http://localhost:8787/internal/insights?window=24h"
  ```

- **`GET /internal/friction`** (same auth) — ranks product pages by
  "friction" using the [Jina Reranker API](https://jina.ai/reranker). There's
  no full-page-content index yet, so it turns each product's view vs.
  add-to-cart counts (from `user-lifecycle-events-*`) into a one-line
  summary, then has `jina-reranker-v3.5` score how well each summary matches
  a friction-describing query — the highest-scoring pages are the ones most
  worth an agent's attention. Returns `jinaConfigured: false` until
  `JINA_API_KEY` is set (see `apps/api/.env.example`).

  ```bash
  curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
    "http://localhost:8787/internal/friction?window=7d&limit=5"

  # -> {
  #      "elasticConfigured": true, "jinaConfigured": true,
  #      "window": "7d",
  #      "query": "high-friction product page: many views, very few add-to-carts, likely confusing or broken",
  #      "results": [
  #        { "productId": "42", "relevanceScore": 0.87,
  #          "summary": "Product page /product/42: 210 views, 6 added to cart (2.9% view-to-cart conversion) in the last 7d." },
  #        ...
  #      ]
  #    }

  # Or point it at a different friction question:
  curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
    "http://localhost:8787/internal/friction?query=pages%20abandoned%20right%20after%20adding%20to%20cart"
  ```

- **`POST /deploy`** (on `apps/deploy-hook`, its own process, port 8788) —
  HMAC-signed. A harness submits a git ref; the webhook clones it, runs the
  full CI gate (lint + test + build), and only on a clean pass builds Docker
  images and deploys them to a self-hosted target over SSH
  (`DOCKER_HOST=ssh://user@host`, no registry needed). Full request/response
  shape, the signing scheme, and the CI-gate-before-deploy guarantee are in
  [`apps/deploy-hook/README.md`](apps/deploy-hook/README.md).

All three are off by default (`INTERNAL_API_KEY` / `JINA_API_KEY` /
`DEPLOY_WEBHOOK_SECRET` unset) — see each app's `.env.example`.

## Elastic Cloud

No deployment exists yet. To stand one up:

```bash
cd infra/pulumi
npm install
export EC_API_KEY="<your Elastic Cloud API key>"
pulumi stack init staging   # or: pulumi stack select staging
pulumi up
```

Repeat with a `production` stack (`pulumi stack init production`) for a
fully isolated production deployment — each stack has its own state and
config (`Pulumi.staging.yaml` / `Pulumi.production.yaml`).

Then wire the printed APM endpoint (`pulumi stack output apmEndpoint`) into
`apps/api/.env` and `apps/web/.env` (see each app's `.env.example`) to turn
on RUM + APM tracing, and see `elastic/README.md` for applying the
traffic-classification ingest pipeline.
