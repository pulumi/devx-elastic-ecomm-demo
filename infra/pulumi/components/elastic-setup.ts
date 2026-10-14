import * as pulumi from "@pulumi/pulumi";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { ElasticRestObject } from "./elastic-resource";
import { DASHBOARD_IDS, dashboardObjects, toNdjson } from "./kibana-dashboards";

const repoRoot = path.resolve(__dirname, "../../..");
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(repoRoot, rel), "utf-8"));

export interface ElasticSetupArgs {
  esUrl: pulumi.Input<string>;
  kibanaUrl: pulumi.Input<string>;
  apiKey: pulumi.Input<string>;
}

// Everything the analytics need inside the existing Elastic project:
// the classification pipeline, four index templates and the Kibana
// dashboards. The Jina models are preconfigured Elastic Inference Service
// endpoints (.jina-embeddings-v5-text-small, .jina-reranker-v3.5), so
// there is nothing to create for them — the templates just reference them.
export class ElasticSetup extends pulumi.ComponentResource {
  public readonly dashboardUrls: pulumi.Output<{ agentsVsHumans: string; agentFriction: string }>;

  constructor(name: string, args: ElasticSetupArgs, opts?: pulumi.ComponentResourceOptions) {
    super("shopfront:elastic:Setup", name, {}, opts);
    const es = { baseUrl: args.esUrl, apiKey: args.apiKey, api: "es" as const };

    const pipeline = new ElasticRestObject(
      "traffic-classification-pipeline",
      // Retained on destroy (deletePaths: []): Elasticsearch refuses to delete a
      // pipeline or template that existing data streams still use, and the
      // collected data outlives the demo infrastructure anyway.
      { ...es, path: "/_ingest/pipeline/traffic-classification", body: readJson("elastic/pipelines/traffic-classification-pipeline.json"), deletePaths: [] },
      { parent: this },
    );

    // Field descriptions live in the template-level _meta (field-level mapping
    // meta is capped at 50 chars); the rest is sent verbatim.
    const templates = ["traffic-classification", "user-lifecycle", "shop-friction", "shop-agent-reports"].map((t) => {
      const { _meta, ...body } = readJson(`packages/contracts/${t}.mapping.json`);
      return new ElasticRestObject(
        `${t}-template`,
        { ...es, path: `/_index_template/${t}`, body: { ...body, _meta: { ..._meta, managed_by: "pulumi" } }, deletePaths: [] },
        { parent: this, dependsOn: [pipeline] },
      );
    });

    const objects = dashboardObjects();
    new ElasticRestObject(
      "kibana-dashboards",
      {
        baseUrl: args.kibanaUrl,
        apiKey: args.apiKey,
        api: "kibana",
        method: "POST",
        path: "/api/saved_objects/_import?overwrite=true",
        ndjsonImport: true,
        body: toNdjson(objects),
        // Dashboards first so nothing references a deleted object mid-destroy.
        deletePaths: [...objects].reverse().map((o) => `/api/saved_objects/${o.type}/${o.id}`),
      },
      { parent: this, dependsOn: templates },
    );

    this.dashboardUrls = pulumi.output(args.kibanaUrl).apply((kb) => ({
      agentsVsHumans: `${kb.replace(/\/$/, "")}/app/dashboards#/view/${DASHBOARD_IDS.agents}`,
      agentFriction: `${kb.replace(/\/$/, "")}/app/dashboards#/view/${DASHBOARD_IDS.friction}`,
    }));
    this.registerOutputs({ dashboardUrls: this.dashboardUrls });
  }
}
