# deploy-hook

A webhook a coding harness (Claude Code, another agent, a CI bot) calls to
submit a git ref for deploy. It never trusts the caller with shell access —
it clones the ref itself, runs the full CI gate (lint + test + build), and
only then builds Docker images and deploys them to a self-hosted target over
SSH. Runs as its own process/port (8788), separate from the customer-facing
API, so deploy credentials (the SSH key, the webhook secret) never live in a
process that also serves public storefront traffic.

## Request flow

```
POST /deploy  (HMAC-signed)
  -> 202 { id }                          -- acks immediately, work is async
  -> clone ref into a scratch dir
  -> npm ci && lint && test && build     -- CI gate; stops here on failure
  -> docker build (both apps, or just the one requested)
  -> docker compose -f docker-compose.prod.yml up -d --build
  -> curl the healthcheck URL with retries
  -> job status: succeeded | failed

GET /deploy/:id -> current status + step-by-step log (poll this)
```

Nothing after the CI gate runs unless every lint/test/build step passed —
this is a coding harness submitting arbitrary code changes, so the CI gate
is the only thing standing between a bad diff and a broken production
deploy. There's no rollback step yet; a failed `docker compose up` leaves
whatever was previously running (Docker doesn't tear down the old container
until the new one starts successfully), but the job is reported `failed`
either way.

## Auth

Every `POST /deploy` must carry:
- `X-Timestamp`: current unix ms (rejected if more than 5 minutes off, to
  block replay of a captured request)
- `X-Signature-256`: `sha256=<hex>` — HMAC-SHA256 of the *raw* request body
  using `DEPLOY_WEBHOOK_SECRET`, verified with a constant-time comparison

Example (bash):

```bash
SECRET="$DEPLOY_WEBHOOK_SECRET"
BODY='{"app":"api","ref":"main","requestedBy":"claude-code","notes":"fix cart qty bug"}'
TS=$(date +%s%3N)
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"

curl -X POST http://localhost:8788/deploy \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature-256: $SIG" \
  -d "$BODY"
# -> {"id":"...", "status":"queued"}

curl http://localhost:8788/deploy/<id>
```

`ref` is validated against a strict allowlist (`^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`,
nothing starting with `-`) before it ever reaches `git checkout` — this is
what stops a ref like `--upload-pack=/bin/sh` from being interpreted as a
git flag. Every shell command is exec'd with an argument array, never a
shell string, so none of this is exploitable via shell metacharacters
either.

## Self-hosted Docker + SSH deploy target

The webhook points the `docker` CLI at a remote daemon
(`DOCKER_HOST=ssh://user@host`) built from `DEPLOY_SSH_USER`/`DEPLOY_SSH_HOST`,
so `docker build` and `docker compose up` run against the target host
directly — no image registry needed. Requirements:

- The target host has Docker installed and reachable over SSH.
- The machine running deploy-hook has SSH key access to
  `DEPLOY_SSH_USER@DEPLOY_SSH_HOST` (non-interactive — an agent-loaded key
  or a key with no passphrase, since the pipeline can't prompt for one).
- `../../docker-compose.prod.yml` env vars (`ELASTIC_APM_SERVER_URL`, etc.)
  are substituted from **the deploy-hook process's own environment** at the
  time it invokes `docker compose` (compose env substitution happens on the
  CLI side, not on the remote daemon) — set them in deploy-hook's `.env`,
  not the target host's.

See `.env.example` for the full config. **Not yet wired to a real host** —
this repo's dev environment has no Docker install, so the pipeline's
git/npm/lint/test/build steps are exercised by `src/pipeline.test.ts` (with
a fake command runner), but the `docker build` / `docker compose up` /
health-check steps have not been run against a live target. Point
`DEPLOY_SSH_HOST` at a real box and watch `GET /deploy/:id` before trusting
it with production traffic.

## Known limitations (reference-implementation tradeoffs)

- **In-memory job store** — a restart loses in-flight job status. Fine for
  a single instance; a real deployment would want a durable queue.
- **One git remote, no rollback, no concurrency limit** — `DEPLOY_GIT_REMOTE`
  is fixed per deploy-hook instance; two concurrent `/deploy` calls will
  both run, competing for the same target's `docker compose up`. Add a
  simple mutex/queue before pointing multiple harnesses at one instance.
- **No per-caller identity** — `requestedBy` is a free-text field the caller
  supplies, not verified. The shared `DEPLOY_WEBHOOK_SECRET` is the only
  authorization boundary; give each harness its own deploy-hook instance
  (own secret) if you need per-caller audit trails or different permissions.
