# Elastic Cloud config (Workstream 4/5)

Config-as-code for the traffic-classification pipeline described in the
project plan. Nothing here is applied automatically yet — it's meant to be
loaded by a small setup script or CI step once a real deployment exists
(`infra/pulumi` outputs the endpoints/credentials).

## Contents
- `pipelines/traffic-classification-pipeline.json` — the ingest pipeline that
  computes the rule-based `traffic.actor` field described in the project plan's
  Bot vs Human Detection Strategy. This is a deliberately simple starting
  heuristic (known bot/agent user-agent substrings, RUM-presence check) —
  expect to tune it once there's labeled traffic to test against.
- `../packages/contracts/traffic-classification.mapping.json` — the index
  template for the `traffic-classification-*` data stream this pipeline feeds.
- `../packages/contracts/user-lifecycle.mapping.json` — the index template for
  `user-lifecycle-events-*`, written directly by `apps/api` (see
  `apps/api/src/lifecycle.ts`) on every `session_start` / `product_viewed` /
  `added_to_cart` / `checkout_started` / `order_completed` event. This is a
  separate raw event stream from `traffic-classification-*` (one doc per
  session-verdict) — join the two on `session.id` at query time (Kibana Lens,
  or the `/internal/insights` API below) to see how the funnel differs
  between human and bot/agent traffic.

## Coding-harness-facing API

`apps/api` exposes `GET /internal/insights` (bearer-token auth via
`INTERNAL_API_KEY`) so a coding agent can pull current classification +
funnel signal before deciding what to build. Returns
`{"elasticConfigured": false, ...}` until `ELASTICSEARCH_URL` is set.

It also exposes `GET /internal/friction`, which reranks product pages by
friction: per-product view/add-to-cart counts from `user-lifecycle-events-*`
are turned into text summaries and scored against a friction query via the
Jina Reranker API (`jina-reranker-v3.5`). Returns
`{"jinaConfigured": false, ...}` until `JINA_API_KEY` is set. There's no raw
page-content index to rerank against yet — swap the synthesized summaries
for real page text (e.g. via a Jina reader model) once one exists.

See the root README's "Coding harness hooks" section for both, including
example requests.

## Not yet built (next up for Workstream 5)
- Elasticsearch ML job definitions (anomaly detection + population analysis)
  — these are usually authored in Kibana's ML UI first, then exported; a job
  config isn't included here yet because it needs real traffic to tune
  against (see Milestones → Phase 3 in the project plan).
- The `apps/classifier` worker that merges the ML score with this pipeline's
  heuristic into the final `traffic.classification` + `traffic.confidence`.
- The Kibana "Bot vs Human" dashboard (Lens).
- Elastic Security detection rules for confirmed-bot alerting.

## Applying once a deployment exists

```bash
curl -X PUT "$ELASTICSEARCH_ENDPOINT/_ingest/pipeline/traffic-classification-pipeline" \
  -u "elastic:$ELASTICSEARCH_PASSWORD" -H 'Content-Type: application/json' \
  --data-binary @pipelines/traffic-classification-pipeline.json

curl -X PUT "$ELASTICSEARCH_ENDPOINT/_index_template/traffic-classification" \
  -u "elastic:$ELASTICSEARCH_PASSWORD" -H 'Content-Type: application/json' \
  --data-binary @../packages/contracts/traffic-classification.mapping.json

curl -X PUT "$ELASTICSEARCH_ENDPOINT/_index_template/user-lifecycle-events" \
  -u "elastic:$ELASTICSEARCH_PASSWORD" -H 'Content-Type: application/json' \
  --data-binary @../packages/contracts/user-lifecycle.mapping.json
```

Then set `ELASTICSEARCH_URL` (+ `ELASTICSEARCH_API_KEY` or
`ELASTICSEARCH_USERNAME`/`ELASTICSEARCH_PASSWORD`) in `apps/api/.env` to turn
on lifecycle-event writes.
