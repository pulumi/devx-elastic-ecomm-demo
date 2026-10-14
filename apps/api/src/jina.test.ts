import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("rerank", () => {
  beforeEach(() => {
    process.env.JINA_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.JINA_API_KEY;
    delete process.env.JINA_RERANK_MODEL;
    vi.unstubAllGlobals();
  });

  it("throws when JINA_API_KEY is not set", async () => {
    delete process.env.JINA_API_KEY;
    const { rerank } = await import("./jina.js");
    await expect(rerank("query", ["doc"])).rejects.toThrow("JINA_API_KEY is not set");
  });

  it("returns [] without calling the API when there are no documents", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { rerank } = await import("./jina.js");

    const result = await rerank("query", []);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the Jina rerank endpoint and maps the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 1, relevance_score: 0.91 },
          { index: 0, relevance_score: 0.12 },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerank } = await import("./jina.js");

    const result = await rerank("friction", ["doc a", "doc b"], 2);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.jina.ai/v1/rerank",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: "jina-reranker-v3.5",
      query: "friction",
      documents: ["doc a", "doc b"],
      top_n: 2,
      return_documents: false,
    });
    expect(result).toEqual([
      { index: 1, relevanceScore: 0.91 },
      { index: 0, relevanceScore: 0.12 },
    ]);
  });

  it("honors JINA_RERANK_MODEL when set", async () => {
    process.env.JINA_RERANK_MODEL = "jina-reranker-v3";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { rerank } = await import("./jina.js");

    await rerank("q", ["doc"]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("jina-reranker-v3");
  });

  it("throws with status and body text on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerank } = await import("./jina.js");

    await expect(rerank("q", ["doc"])).rejects.toThrow(/401/);
  });
});
