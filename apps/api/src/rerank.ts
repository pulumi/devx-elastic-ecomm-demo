import { esClient } from "./es-client.js";
import { isJinaConfigured, rerank as jinaRerank, type RerankResult } from "./jina.js";

// Jina reranker served by the Elastic Inference Service. Preconfigured on
// Elastic Serverless / Cloud, so no separate Jina key is needed.
export const ELASTIC_RERANK_ID = process.env.ELASTIC_RERANK_INFERENCE_ID ?? ".jina-reranker-v3.5";

export const rerankBackend: "elastic" | "jina" | null = esClient ? "elastic" : isJinaConfigured ? "jina" : null;

export async function rerank(query: string, documents: string[], topN?: number): Promise<RerankResult[]> {
  if (documents.length === 0) return [];
  if (rerankBackend === "elastic" && esClient) {
    const res = (await esClient.inference.rerank({
      inference_id: ELASTIC_RERANK_ID,
      query,
      input: documents,
      task_settings: { top_n: topN ?? documents.length, return_documents: false },
    })) as unknown as { rerank: { index: number; relevance_score: number }[] };
    return res.rerank.map((r) => ({ index: r.index, relevanceScore: r.relevance_score }));
  }
  if (rerankBackend === "jina") return jinaRerank(query, documents, topN);
  throw new Error("No reranker configured: set ELASTICSEARCH_URL (Elastic-hosted Jina) or JINA_API_KEY");
}
