import * as pulumi from "@pulumi/pulumi";

// A small Pulumi dynamic provider for Elasticsearch / Kibana REST objects:
// ingest pipelines, index templates and Kibana saved-object imports. It
// PUTs (or POSTs) a JSON body on create/update and DELETEs on destroy, so
// the objects' lifecycle follows `pulumi up` / `pulumi destroy` like any
// other resource.

export interface ElasticRestInputs {
  /** Elasticsearch or Kibana base URL. */
  baseUrl: pulumi.Input<string>;
  apiKey: pulumi.Input<string>;
  /** "es" for Elasticsearch APIs, "kibana" adds the kbn-xsrf header. */
  api: pulumi.Input<"es" | "kibana">;
  /** Path for create/update, e.g. /_ingest/pipeline/traffic-classification */
  path: pulumi.Input<string>;
  method?: pulumi.Input<"PUT" | "POST">;
  /** JSON body, or NDJSON text when `ndjsonImport` is set. */
  body: pulumi.Input<any>;
  /** Send `body` as a multipart NDJSON file (Kibana saved-objects _import). */
  ndjsonImport?: pulumi.Input<boolean>;
  /** Paths to DELETE on destroy. Defaults to [path]. */
  deletePaths?: pulumi.Input<pulumi.Input<string>[]>;
}

interface State {
  baseUrl: string;
  apiKey: string;
  api: "es" | "kibana";
  path: string;
  method?: "PUT" | "POST";
  body: any;
  ndjsonImport?: boolean;
  deletePaths?: string[];
  response?: string;
}

const provider: pulumi.dynamic.ResourceProvider = {
  async create(inputs: State) {
    const response = await apply(inputs);
    return { id: inputs.path, outs: { ...inputs, response } };
  },

  async update(_id: string, _olds: State, news: State) {
    const response = await apply(news);
    return { outs: { ...news, response } };
  },

  async diff(_id: string, olds: State, news: State) {
    const replaces = olds.path !== news.path || olds.baseUrl !== news.baseUrl ? ["path"] : [];
    const changes =
      replaces.length > 0 ||
      JSON.stringify(olds.body) !== JSON.stringify(news.body) ||
      olds.apiKey !== news.apiKey ||
      olds.method !== news.method;
    return { changes, replaces, deleteBeforeReplace: true };
  },

  async delete(_id: string, props: State) {
    for (const path of props.deletePaths ?? [props.path]) {
      const res = await request(props, "DELETE", path);
      // Serverless Kibana disables some saved-object APIs; don't block destroy on them.
      if (res.status === 400 && props.api === "kibana" && (await res.clone().text()).includes("not available with the current configuration")) {
        console.warn(`skipping DELETE ${path}: not available on this Kibana`);
        continue;
      }
      if (!res.ok && res.status !== 404) {
        throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text()}`);
      }
    }
  },
};

async function request(p: State, method: string, path: string, body?: any) {
  const headers: Record<string, string> = { Authorization: `ApiKey ${p.apiKey}` };
  if (p.api === "kibana") headers["kbn-xsrf"] = "pulumi";
  let payload: any;
  if (body !== undefined && p.ndjsonImport) {
    const form = new FormData();
    form.append("file", new Blob([String(body)], { type: "application/ndjson" }), "objects.ndjson");
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${p.baseUrl.replace(/\/$/, "")}${path}`, { method, headers, body: payload });
}

async function apply(p: State): Promise<string> {
  const res = await request(p, p.method ?? "PUT", p.path, p.body);
  const text = await res.text();
  if (!res.ok) throw new Error(`${p.method ?? "PUT"} ${p.path} failed: ${res.status} ${text}`);
  // Kibana _import reports per-object failures inside a 200 response.
  if (p.ndjsonImport) {
    const parsed = JSON.parse(text);
    if (!parsed.success) throw new Error(`Kibana import reported errors: ${JSON.stringify(parsed.errors ?? parsed).slice(0, 2000)}`);
  }
  return text.slice(0, 500);
}

export class ElasticRestObject extends pulumi.dynamic.Resource {
  public readonly response!: pulumi.Output<string>;

  constructor(name: string, args: ElasticRestInputs, opts?: pulumi.CustomResourceOptions) {
    super(provider, name, { response: undefined, ...args, apiKey: pulumi.secret(args.apiKey) }, opts, "shopfront", "ElasticRestObject");
  }
}
