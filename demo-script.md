# Demo script: "Is your shop ready for AI agents?"

An infrastructure-provisioning demo video. One `pulumi up` stands up a storefront on AWS, a scheduled traffic generator, and Elastic analytics that split shoppers into **humans vs AI agents**. Elastic-hosted **Jina** models then rank where agents hit friction.

> **Current scope: no LLM agents.** The Anthropic-backed pieces (LLM shopping agents and their trip reports, Claude catalogue generation) are switched off for now; they'll be rewired later to third-party inference endpoints. Everything below works without them: the agent traffic is the scripted agents, the catalogue comes from the offline generator, and the "trip report" panels on the Agent Friction dashboard stay empty, so don't linger on them. The video only *surfaces* the friction; it doesn't fix the shop.

This file is written for the agent producing the video. It covers every command, segment, caption and voiceover line, plus the config files to create for **demo-recorder**, **terminal-vid**, **trapper-keeper-gfx** (TK) and, optionally, **teleprompter**.

- **Target length:** about 5 minutes. Terminal segments are condensed, and the real `pulumi up` takes about 6–8 minutes.
- **Tone:** paced for people watching on their own; each step has a title card. The palette matches the AICR videos: Pulumi dark `#1F1B21`, purple `#492E8E`, text `#FAFAFA`, accent `#C3BDFF`.

---

## 0. Before you start (read fully)

### Paths
The folders were reorganised recently. Current locations:

| Tool | Path |
|---|---|
| This repo (Shopfront) | `/Users/peter/dev-projects/projects/elastic-ecomm-demo` |
| demo-recorder | `/Users/peter/dev-projects/projects/demo-recorder` |
| terminal-vid | `/Users/peter/dev-projects/projects/terminal-vid` |
| trapper-keeper-gfx | `/Users/peter/dev-projects/projects/trapper-keeper-gfx` |
| teleprompter | `/Users/peter/dev-projects/projects/teleprompter` |

⚠️ demo-recorder's existing AICR configs still point at `/Users/peter/dev-projects/vendor/demo-recorder/...` (logo images, `cwd`). When you copy an AICR config as a template, **rewrite `vendor/demo-recorder` to `projects/demo-recorder`**.

### Accounts and credentials (check before recording anything)
Run these in `elastic-ecomm-demo/`:

```sh
aws login && aws sts get-caller-identity          # AWS us-east-1 sandbox (default profile)
pulumi whoami                                      # Pulumi Cloud: pyoakum-pulumi-com
pulumi -C infra/pulumi stack select demo
pulumi -C infra/pulumi config                      # esUrl, kibanaUrl, apiKey (secret) must be set
```

- **Safari** must be signed in to Elastic Cloud so the Kibana scenes load without a login page.
- **Permissions:** the terminal app needs macOS Screen Recording and Accessibility permission (the AppleScript scenes type into Safari).

### Never show on screen
The Elasticsearch API key, `internalApiKeyValue`, and the AWS account ID. Put these in `project.shopfront.json` → `redaction_patterns`:
- the 12-digit account ID (`aws sts get-caller-identity --query Account --output text`)
- `ApiKey [A-Za-z0-9+/=]{20,}`
- `sk-ant-[A-Za-z0-9_-]+`
- `essu_[A-Za-z0-9]+`

Never run `pulumi stack output --show-secrets` or `pulumi config --show-secrets` on camera. `pulumi config` (without the flag) shows `[secret]` placeholders, and those are fine to show.

### What's real and what's simulated (say this accurately in voiceover)
- The shop, the AWS infrastructure, the Elastic pipeline and dashboards, and the Jina ranking are all real.
- The **shoppers** come from `apps/traffic-gen`:
  - **human-browser:** headless Chromium clicking through the real storefront with human pacing.
  - **agent-scripted:** replays the published user agents and behaviour of ChatGPT-User, Claude-User, Perplexity, GPTBot/ClaudeBot, MCP clients, and undeclared automation.
  - **agent-llm:** off for now. It will later be real LLM agents shopping over raw HTTP and writing trip reports.
- Each request carries `X-Synthetic-Persona` as ground truth. The classifier never reads it; the "Classifier vs ground truth" panel uses it to score the classifier.
- The shop's friction is **not staged**. It comes from how the shop is built:
  - It's a client-rendered SPA, so HTML fetches return an empty shell.
  - Search is plain `LIKE`.
  - The cart silently requires an `X-Session-Id` header.
  - There's no sitemap, robots.txt, llms.txt or OpenAPI description.

---

## 1. Pre-production (off camera, once)

Do this at least 30 minutes before recording, so Elastic already has traffic to show.

```sh
cd /Users/peter/dev-projects/projects/elastic-ecomm-demo
npm install
cd infra/pulumi && npm install && cd ../..

# Stack config (already done for stack "demo"; repeat only if you use a new stack)
pulumi -C infra/pulumi config set elastic:esUrl   https://my-observability-project-d8817d.es.us-central1.gcp.elastic.cloud
pulumi -C infra/pulumi config set elastic:kibanaUrl https://my-observability-project-d8817d.kb.us-central1.gcp.elastic.cloud
grep '^ELASTIC_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | pulumi -C infra/pulumi config set --secret elastic:apiKey
pulumi -C infra/pulumi config set deployAws true
```

**Rehearsal:** run the full flow once (steps 2–8 below) without recording. Then `pulumi destroy` and `pulumi up` again, so the recorded `up` is a real first-time create.

- If you'd rather record `up` against an already-populated Elastic, keep the rehearsal stack. The dashboards will show a day of scheduled waves; only the AWS resources will be "create".
- The scheduled traffic runs every 10 minutes (config `trafficSchedule`). Waves from the rehearsal are what fill the dashboards on camera.

---

## 2. Storyboard

| # | Segment ids | Card (kicker / title / body) | What the viewer sees | Checklist label |
|---|---|---|---|---|
| intro | `intro` | *Is your shop ready for AI agents?* | Pulumi logo + title | — |
| 1 | `card-01`, `01-config` | STEP 1 OF 8 · **Configure the stack** · Point Pulumi at Elastic and AWS. Secrets stay encrypted. | `pulumi config` | Configure |
| 2 | `card-02`, `02-preview` | STEP 2 OF 8 · **Preview the plan** · Elastic pipeline, index templates, dashboards — and the AWS stack. | `pulumi preview` resource tree | Preview |
| 3 | `card-03`, `03-up`, `03-outputs` | STEP 3 OF 8 · **Deploy everything** · One command: Elastic config, ECS Fargate shop, scheduled traffic. | `pulumi up` (timelapsed), then outputs | Deploy |
| 4 | `card-04`, `04-content` | STEP 4 OF 8 · **Stock the shelves** · A content tool fills the catalogue. | `npm run content -- generate` | Stock the shelves |
| 5 | `card-05`, `05-shop` | STEP 5 OF 8 · **Open for business** · The shop, live on AWS. | Safari: browse, search, open product | Open the shop |
| 6 | `card-06`, `06-traffic` | STEP 6 OF 8 · **Send in the shoppers** · Humans, AI agents and bots — every request tagged. | `npm run traffic` output | Send traffic |
| 7 | `card-07`, `07-dashboards` | STEP 7 OF 8 · **Who's shopping?** · Elastic classifies every request at ingest. | Kibana: Agents vs Humans, then Agent Friction | See who's shopping |
| 8 | `card-08`, `08-friction` | STEP 8 OF 8 · **Find the friction** · Jina models rank where agents get stuck. | `npm run friction` report | Find the friction |
| outro | `outro` | *Surface agent friction first. Fix it next.* | Logo + CTA | — |

Optional closer: add `card-09` / `09-destroy` (**Tear it down**, `pulumi destroy`) if the cut is under 5 minutes.

---

## 3. Segment detail

Every terminal segment is **recorded as a cast, then rendered by terminal-vid**; nothing is screen-recorded. Record with demo-recorder:

```sh
cd /Users/peter/dev-projects/projects/demo-recorder
SHOP=/Users/peter/dev-projects/projects/elastic-ecomm-demo
./venv/bin/python cli.py record --segment <id> --cwd <cwd> -- <command...>
```

Each recording writes `work/casts/<id>/NN.cast` (140×30 PTY, live redaction). Browser segments are `kind: live` captures driven by the AppleScripts in `$SHOP/demo/`.

### intro (titlecard, 4.5s)
- **Captions:** Pulumi logo (`logo-center`), plus `hero-bold` "Is your shop ready for AI agents?"
- **VO:** "More and more of your shoppers aren't people. They're AI agents buying on someone's behalf. So how do you know if your store works for them? Let's build a way to find out, with Pulumi and Elastic."

### Step 1: Configure the stack · `01-config`
```sh
cli.py record --segment 01-config --cwd $SHOP/infra/pulumi -- pulumi stack select demo
cli.py record --segment 01-config --cwd $SHOP/infra/pulumi -- pulumi config
```
- **Screenplay:** `display: "pulumi config"`. Add `beats: [{"after": "elastic:apiKey", "steps": [{"caption": {"text": "Secrets are encrypted by Pulumi Cloud", "duration": "3s", "position": "bottom"}}]}]`.
- **VO:** "One Pulumi stack holds everything: the Elastic project we're reporting into, the AWS region, and the API keys, which Pulumi stores encrypted."

### Step 2: Preview · `02-preview`
```sh
cli.py record --segment 02-preview --cwd $SHOP/infra/pulumi -- pulumi preview
```
- **Screenplay beats:**
  - `after: "shopfront:elastic:Setup"` → caption "Elastic: ingest pipeline, 4 index templates, 2 Kibana dashboards"
  - `after: "shopfront:aws:Shop"` → caption "AWS: VPC, ALB, ECS Fargate, EFS, ECR"
  - `after: "shopfront:aws:TrafficGenerator"` → caption "A scheduled traffic generator"
  - `after: "Resources:"` → `camera: {zoom: 1.4, focus: "bottom", duration: "600ms"}`
- **VO:** "The preview shows three parts. In Elastic: a classification pipeline, index templates, and two dashboards. On AWS: the shop on ECS Fargate behind a load balancer. And a traffic generator that runs on a schedule."

### Step 3: Deploy · `03-up`, `03-outputs`
```sh
cli.py record --segment 03-up --cwd $SHOP/infra/pulumi -- pulumi up --yes
cli.py record --segment 03-outputs --cwd $SHOP/infra/pulumi -- pulumi stack output
```
- **Screenplay:**
  - `03-up`: `max_wait: 2.0`, so long idle gaps are clamped. Beats:
    - `after: "traffic-classification-pipeline"` → caption "Elastic configured first"
    - `after: "shopfront-api-image"` → caption "Images built and pushed to ECR"
    - `after: "Resources:"` → caption "≈60 resources, one command"
  - `03-outputs`: highlight the `shopUrl` and `kibanaDashboards` lines.
- **Captions:** `side-note` over `03-up`: "Condensed — real time ≈ 7 min".
- **VO:** "pulumi up. Pulumi configures Elastic, builds the shop and generator images, and brings everything up on AWS in dependency order. The outputs give us the shop's URL and links straight to the dashboards."

### Step 4: Stock the shelves · `04-content`
```sh
cli.py record --segment 04-content --cwd $SHOP -- npm run -s content -- generate --count 24 --theme "home goods and small gifts" --replace
cli.py record --segment 04-content --cwd $SHOP -- npm run -s content -- list
```
- The content CLI finds the shop URL and internal key through `pulumi stack output`, so no secrets appear on screen.
- **Screenplay beats:** `after: "✓ wrote"` → caption "Catalogue loaded through the shop's admin API".
- **VO:** "An empty store isn't much of a test. This content tool generates a catalogue and loads it through the shop's admin API. You can also import your own JSON or reset to the seed data."

### Step 5: Open for business · `05-shop` (live browser)
- **segments.shopfront.json:**
  ```json
  {"id": "05-shop", "label": "The shop in Safari", "kind": "live",
   "command": "sh -c 'osascript /Users/peter/dev-projects/projects/elastic-ecomm-demo/demo/shop_browse.applescript \"$(pulumi -C /Users/peter/dev-projects/projects/elastic-ecomm-demo/infra/pulumi stack output shopUrl)\"'",
   "cwd": "/Users/peter/dev-projects/projects/demo-recorder",
   "region_override": {"x": 200, "y": 120, "w": 2560, "h": 1440}, "max_duration_s": 25}
  ```
- **Rehearse first:** `shop_browse.applescript` reaches the search box with Tab presses. Check the count in a rehearsal and adjust it if focus lands elsewhere.
- **VO:** "Here's the shop, live on AWS. To a person it works fine: search, browse, add to cart."

### Step 6: Send in the shoppers · `06-traffic`
```sh
cli.py record --segment 06-traffic --cwd $SHOP -- sh -c 'npm run -s traffic -- --target "$(pulumi -C infra/pulumi stack output shopUrl)" --humans 3 --agents 12 --spread-seconds 30'
```
- This is one wave run locally, so viewers can watch it. The same generator also runs on AWS every 10 minutes.
- **Screenplay:** `max_wait: 1.5`. Beats:
  - `after: "html-reader"` → caption "Agents that read HTML see an empty page"
  - `after: "every search returned zero results"` → caption "Natural-language searches find nothing"
  - `after: "Wave complete"` → `camera: {zoom: 1.5, focus: "bottom"}`
- **VO:** "Now the shoppers: people in a real browser, and AI traffic modelled on assistants like ChatGPT and Claude, crawlers, and undeclared automation. Every request is tagged so we can check the classifier later. Watch the agents: the ones reading HTML give up, and the ones calling the API trip over search and the cart."

### Step 7: Who's shopping? · `07-dashboards` (live browser)
- **segments.shopfront.json:**
  ```json
  {"id": "07-dashboards", "label": "Kibana dashboards", "kind": "live",
   "command": "sh -c 'D=/Users/peter/dev-projects/projects/elastic-ecomm-demo/infra/pulumi; osascript /Users/peter/dev-projects/projects/elastic-ecomm-demo/demo/kibana_dashboards.applescript \"$(pulumi -C $D stack output kibanaDashboards --json | jq -r .agentsVsHumans)\" \"$(pulumi -C $D stack output kibanaDashboards --json | jq -r .agentFriction)\"'",
   "cwd": "/Users/peter/dev-projects/projects/demo-recorder",
   "region_override": {"x": 200, "y": 120, "w": 2560, "h": 1440}, "max_duration_s": 60}
  ```
- **Captions** (`lower-third`, timed from segment start):
  - 1s "Every request classified at ingest — human, agent or bot"
  - 12s "Agents convert far less than humans"
  - 24s "Classifier checked against ground truth"
  - 34s "Agent Friction: where each kind of shopper hits a wall"
- **VO:** "In Kibana, an Elastic ingest pipeline has classified every request as human, AI agent or bot, from signals like the user agent, declared agent headers, whether our JavaScript ran, and request rate. The funnel shows it: agents browse, but few check out. And because the synthetic traffic carries ground truth, we can see how accurate the classifier is. The friction dashboard breaks down where agents hit walls: empty HTML, searches that return nothing, a cart that rejects them."

### Step 8: Find the friction · `08-friction`
```sh
cli.py record --segment 08-friction --cwd $SHOP -- sh -c 'set -a; . ./.env.demo; set +a; npm run -s friction -- --window 24h'
```
- `.env.demo` is **not** the repo `.env`, because the repo `.env` has a line that isn't shell-safe. Create it off camera:
  ```sh
  printf 'ELASTICSEARCH_URL=%s\nELASTICSEARCH_API_KEY=%s\n' \
    https://my-observability-project-d8817d.es.us-central1.gcp.elastic.cloud \
    "$(grep '^ELASTIC_API_KEY=' .env | cut -d= -f2-)" > .env.demo
  ```
- **Screenplay:** use `drop: ["^Saved to "]`. Beats:
  - `after: "Friction themes, ranked"` → caption "Jina reranker scores every piece of evidence against each theme"
- **VO:** "Finally, the Jina models in Elastic. The report turns everything we collected into plain-language evidence, and Jina's reranker scores it against the questions a shop owner cares about. Top of the list: agents can't see products in our HTML. No fixes yet. First we know exactly where the friction is."

### outro (titlecard, 5s)
- **Captions:** logo, `hero-bold` "Surface agent friction first. Fix it next.", `cta-url` "pulumi.com/templates" (confirm the final URL with Peter).
- **VO:** "One Pulumi program, from infrastructure to insight. Next time: fixing what the agents found."

### Optional: Tear it down · `09-destroy`
```sh
cli.py record --segment 09-destroy --cwd $SHOP/infra/pulumi -- pulumi destroy --yes
```
Caption `side-note`: "Removes the AWS resources and Kibana dashboards; the Elastic pipeline, templates and collected data are kept".

---

## 4. Files to create in demo-recorder

Copy the AICR v3 set as templates and adapt them (and fix the `vendor/` → `projects/` paths):

| New file | Based on | Changes |
|---|---|---|
| `config/project.shopfront.json` | `project.aicr-v3.json` | `title: "Is your shop ready for AI agents?"`, `output.path: "out/shopfront-base.mp4"`, `work_dir: "work/shopfront"`, `redaction_patterns` from §0 |
| `config/screenplay/shopfront.json` | `screenplay/aicr.json` | `out_dir: ".../terminal-vid/scripts/shopfront"`, `cwd: "~/dev/shopfront"`, `path_map: [["/Users/peter/dev-projects/projects/elastic-ecomm-demo", "~/dev/shopfront"], ["/Users/peter", "~"]]`, one entry per terminal segment in §3 with the listed `display`, `beats` and `drop` |
| `config/screenplay.settings.yaml` | (reuse) | Only change `window.title` to `"zsh — shopfront"` in a screenplay-level `settings` override |
| `config/segments.shopfront.json` | `segments.aicr-v3.json` | Ids from §2. Title cards: `kind: titlecard`. Terminal segments: `kind: prerendered`, `source: /Users/peter/dev-projects/projects/terminal-vid/out/shopfront/<id>.mp4`. Browser segments: exactly as in §3 |
| `config/captions.shopfront.json` | `captions.aicr-v3.json` | Keep `styles` unchanged. For each card, the three captions `card-NN-k/t/b` (kicker/title/body from §2), plus the intro/outro, side-note and lower-third captions from §3 |
| `config/checklist.shopfront.json` | `checklist.aicr-v3.json` | `show_after: "intro"`, `hide_before: "outro"`, `steps` = checklist labels from §2 with their segment ids, `video_title: "Is your shop ready for AI agents?"` |

---

## 5. Production order

```sh
cd /Users/peter/dev-projects/projects/demo-recorder
./venv/bin/python cli.py doctor

# 1. Record terminal casts (§3), in story order, against the live stack.
# 2. Casts -> terminal-vid screenplays
./venv/bin/python cast2screenplay.py --spec config/screenplay/shopfront.json --casts work/casts
# 3. Render each terminal segment
cd ../terminal-vid
for s in 01-config 02-preview 03-up 03-outputs 04-content 06-traffic 08-friction; do
  npm run render -- scripts/shopfront/$s.yaml -o out/shopfront/$s.mp4
done
# 4. Browser scenes
cd ../demo-recorder
./venv/bin/python cli.py capture run --segment 05-shop       --project config/project.shopfront.json --segments config/segments.shopfront.json
./venv/bin/python cli.py capture run --segment 07-dashboards --project config/project.shopfront.json --segments config/segments.shopfront.json
./venv/bin/python cli.py redact-check --segment 07-dashboards --project config/project.shopfront.json
# 5. Title cards need no capture; center the card text, then assemble
./venv/bin/python cli.py center-cards --project config/project.shopfront.json --segments config/segments.shopfront.json --captions config/captions.shopfront.json
./venv/bin/python cli.py assemble --project config/project.shopfront.json --segments config/segments.shopfront.json --captions config/captions.shopfront.json
# 6. Step checklist overlay (TK must be running: cd ../trapper-keeper-gfx && npm run dev)
./venv/bin/python cli.py checklist --segments config/segments.shopfront.json --spec config/checklist.shopfront.json \
  --base out/shopfront-base.mp4 --project-id shopfront-checklist --project config/project.shopfront.json
cd ../trapper-keeper-gfx && npm run render -- shopfront-checklist --mode composite --name shopfront
# -> trapper-keeper-gfx/renders/shopfront_composite_<timestamp>.mp4
# 7. (Optional) voiceover: load that render into teleprompter, paste §6, "Split script across segments".
```

---

## 6. Voiceover (teleprompter paste)

One block per segment, in cut order, separated by `---`. Title-card segments get short blocks so the split lines up with segment order.

```
More and more of your shoppers aren't people. They're AI agents buying on someone's behalf. So how do you know if your store works for them? Let's build a way to find out, with Pulumi and Elastic.
---
Step one.
---
One Pulumi stack holds everything: the Elastic project we're reporting into, the AWS region, and the API keys, which Pulumi stores encrypted.
---
Step two.
---
The preview shows three parts. In Elastic: a classification pipeline, index templates, and two dashboards. On AWS: the shop on ECS Fargate behind a load balancer. And a traffic generator that runs on a schedule.
---
Step three.
---
pulumi up. Pulumi configures Elastic, builds the shop and generator images, and brings everything up on AWS in dependency order.
---
The outputs give us the shop's URL and links straight to the dashboards.
---
Step four.
---
An empty store isn't much of a test. This content tool generates a catalogue and loads it through the shop's admin API.
---
Step five.
---
Here's the shop, live on AWS. To a person it works fine: search, browse, add to cart.
---
Step six.
---
Now the shoppers: people in a real browser, and AI traffic modelled on assistants like ChatGPT and Claude, crawlers, and undeclared automation. Every request is tagged so we can check the classifier later. Watch the agents: the ones reading HTML give up, and the ones calling the API trip over search and the cart.
---
Step seven.
---
In Kibana, an Elastic ingest pipeline has classified every request as human, AI agent or bot. The funnel shows it: agents browse, but few check out. The friction dashboard breaks down where they hit walls: empty HTML, searches that return nothing, a cart that rejects them.
---
Step eight.
---
Finally, the Jina models in Elastic. Jina's reranker scores our evidence against the questions a shop owner cares about. No fixes yet. First we know exactly where the friction is.
---
One Pulumi program, from infrastructure to insight. Next time: fixing what the agents found.
```

---

## 7. QA before you hand off the cut

- [ ] No API keys, account IDs or `internalApiKeyValue` visible anywhere. Run `redact-check` on both browser segments.
- [ ] `pulumi up` in the cut is a create (green `+`), not an update, unless you chose the populated-stack option in §1.
- [ ] The Kibana panels have data: "Human sessions", "AI agent sessions" and "Friction events · agents" are non-zero. If not, run `$(pulumi stack output runTrafficWave)` a few times and wait 2 minutes.
- [ ] The friction report's top theme matches what the dashboards show.
- [ ] The voiceover matches §0 "What's real and what's simulated". Don't say the traffic is from real customers.
- [ ] The final file is in `trapper-keeper-gfx/renders/`. Also copy it to `elastic-ecomm-demo/demo/out/` for Peter.
