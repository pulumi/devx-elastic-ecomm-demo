import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { ElasticSetup } from "./components/elastic-setup";
import { Shop } from "./components/shop";
import { TrafficGenerator } from "./components/traffic-generator";

// Shopfront agent-vs-human demo, end to end:
//   1. Elastic: classification pipeline, index templates, Kibana dashboards
//      on an existing Elastic project (config: elastic:*).
//   2. AWS: the shop on ECS Fargate behind an ALB.
//   3. AWS: a scheduled Fargate task that sends waves of human, scripted
//      agent and LLM agent shoppers at the shop.

const elastic = new pulumi.Config("elastic");
const esUrl = elastic.require("esUrl");
const kibanaUrl = elastic.require("kibanaUrl");
const esApiKey = elastic.requireSecret("apiKey");
const apmServerUrl = elastic.get("apmServerUrl");

const cfg = new pulumi.Config();
const deployAws = cfg.getBoolean("deployAws") ?? true;
const anthropicApiKey = cfg.getSecret("anthropicApiKey");

const elasticSetup = new ElasticSetup("elastic", { esUrl, kibanaUrl, apiKey: esApiKey });

export const kibanaDashboards = elasticSetup.dashboardUrls;

// Shared secret for /internal/* (catalogue admin, insights, friction).
const internalApiKey = new random.RandomPassword("internal-api-key", { length: 40, special: false });
export const internalApiKeyValue = pulumi.secret(internalApiKey.result);

let shopUrlOut: pulumi.Output<string> | undefined;
let runTrafficWaveOut: pulumi.Output<string> | undefined;
let shopLogGroupOut: pulumi.Output<string> | undefined;

if (deployAws) {
  const shop = new Shop("shopfront", { esUrl, esApiKey, internalApiKey: internalApiKey.result, apmServerUrl }, { dependsOn: [elasticSetup] });

  const traffic = new TrafficGenerator("traffic", {
    targetUrl: shop.url,
    vpc: shop.vpc,
    cluster: shop.cluster,
    esUrl,
    esApiKey,
    anthropicApiKey,
    schedule: cfg.get("trafficSchedule") ?? "rate(10 minutes)",
    enabled: cfg.getBoolean("trafficEnabled") ?? true,
    humans: cfg.getNumber("trafficHumans") ?? 4,
    agents: cfg.getNumber("trafficAgents") ?? 12,
    llmRuns: anthropicApiKey ? (cfg.getNumber("trafficLlmRuns") ?? 2) : 0,
  });

  shopUrlOut = shop.url;
  runTrafficWaveOut = traffic.runTaskCommand;
  shopLogGroupOut = shop.logGroupName;
}

export const shopUrl = shopUrlOut;
export const runTrafficWave = runTrafficWaveOut;
export const shopLogGroup = shopLogGroupOut;
