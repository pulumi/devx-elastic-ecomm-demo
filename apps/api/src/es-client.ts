import { Client } from "@elastic/elasticsearch";

// ELASTIC_API_KEY is accepted as an alias because that's the name the
// Elastic console hands out (and what the repo-root .env uses).
const apiKey = process.env.ELASTICSEARCH_API_KEY ?? process.env.ELASTIC_API_KEY;

// No-op (null) when no Elasticsearch endpoint is configured, so the API
// runs with zero Elastic setup. All event writes become no-ops.
export const esClient: Client | null = process.env.ELASTICSEARCH_URL
  ? new Client({
      node: process.env.ELASTICSEARCH_URL,
      auth: apiKey
        ? { apiKey }
        : process.env.ELASTICSEARCH_USERNAME
          ? { username: process.env.ELASTICSEARCH_USERNAME!, password: process.env.ELASTICSEARCH_PASSWORD! }
          : undefined,
    })
  : null;

export const isElasticConfigured = esClient !== null;

// Data-stream names. The "-shopfront" suffix matches the *-* patterns the
// index templates (packages/contracts) are registered for.
export const STREAMS = {
  traffic: "traffic-classification-shopfront",
  lifecycle: "user-lifecycle-events-shopfront",
  friction: "shop-friction-shopfront",
} as const;

type Stream = (typeof STREAMS)[keyof typeof STREAMS];

// Every request produces at least one document, so writes are buffered and
// flushed with one bulk call instead of one round trip per request. Data
// streams only accept `create`, and the index templates attach the
// traffic-classification pipeline as default_pipeline.
const FLUSH_MS = 2_000;
const MAX_BUFFER = 500;
let buffer: { index: Stream; doc: object }[] = [];
let timer: NodeJS.Timeout | undefined;

export function enqueue(index: Stream, doc: object) {
  if (!esClient) return;
  buffer.push({ index, doc });
  if (buffer.length >= MAX_BUFFER) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

export async function flush() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!esClient || buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    const res = await esClient.bulk({
      operations: batch.flatMap(({ index, doc }) => [{ create: { _index: index } }, doc]),
    });
    if (res.errors) {
      const first = res.items.find((i) => i.create?.error)?.create?.error;
      console.warn(`elastic bulk write had errors: ${JSON.stringify(first)}`);
    }
  } catch (err) {
    // Telemetry must never break the storefront; drop the batch.
    console.warn(`elastic bulk write failed: ${(err as Error).message}`);
  }
}
