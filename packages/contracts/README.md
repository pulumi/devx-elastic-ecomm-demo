# Contracts

Shared interfaces that the `apps/web`, `apps/api`, and Elastic-facing workstreams
build against. Nothing here is owned by a single workstream — changes go through
review from every consumer.

- `openapi.yaml` — the Shopfront REST API. `apps/web` and `apps/api` both build
  against this; it is the only thing that should cross that boundary (no shared
  TS types imported directly between the two apps).
- `seed-data/products.json` — fixture catalog data used by `apps/api` in dev/test
  and by any load-testing harness.
- `traffic-classification.mapping.json` — the Elasticsearch index template for the
  `traffic-classification-*` data stream (ECS-aligned + a custom `traffic.*`
  namespace). This is the only schema the classifier, Kibana dashboards, and any
  in-app admin view should depend on.
