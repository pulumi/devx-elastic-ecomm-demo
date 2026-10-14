const RERANK_URL = "https://api.jina.ai/v1/rerank";
const DEFAULT_MODEL = "jina-reranker-v3.5";

export const isJinaConfigured = !!process.env.JINA_API_KEY;

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

interface RerankApiResponse {
  results: { index: number; relevance_score: number }[];
}

// Thin wrapper around the Jina Reranker REST API. Scores each document's
// relevance to `query` (0-1, higher = more relevant) and returns results
// sorted descending by score — the API does the sorting, this just narrows
// the response shape to what callers need.
export async function rerank(query: string, documents: string[], topN?: number): Promise<RerankResult[]> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error("JINA_API_KEY is not set");
  if (documents.length === 0) return [];

  const res = await fetch(RERANK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.JINA_RERANK_MODEL ?? DEFAULT_MODEL,
      query,
      documents,
      top_n: topN ?? documents.length,
      return_documents: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jina rerank request failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as RerankApiResponse;
  return data.results.map((r) => ({ index: r.index, relevanceScore: r.relevance_score }));
}
