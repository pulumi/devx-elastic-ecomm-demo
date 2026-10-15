// Turns Elasticsearch aggregations into plain-language evidence statements.
// Each statement is one candidate "document" the Jina reranker scores
// against the friction themes, so it must say what happened, to whom, and
// how often — in words, since that's what the reranker understands.

export interface Evidence {
  text: string;
  weight: number; // how many events/sessions stand behind it
  actor: string;
  source: "friction" | "traffic" | "funnel" | "report";
}

type Bucket = { key: string; doc_count: number; [sub: string]: any };

const FRICTION_PHRASES: Record<string, string> = {
  not_found: "requested products or pages that do not exist (HTTP 404)",
  zero_results: "searched the catalogue and got zero results",
  validation_error: "sent requests the API rejected as invalid",
  missing_session: "were rejected by the cart or checkout because the request lacked the X-Session-Id header",
  checkout_error: "had checkout fail (missing email or empty cart)",
  retry: "retried the same request right after it failed",
  no_machine_readable: "looked for robots.txt, sitemap.xml, llms.txt or an API description and got the HTML app shell instead",
};

export function frictionEvidence(byTypeActor: Bucket[]): Evidence[] {
  return byTypeActor.flatMap((t) =>
    (t.by_actor?.buckets ?? []).map((a: Bucket) => ({
      text: `${a.doc_count} times, ${a.key} shoppers ${FRICTION_PHRASES[t.key] ?? `hit ${t.key}`}.${exampleDetail(a)}`,
      weight: a.doc_count,
      actor: a.key,
      source: "friction" as const,
    })),
  );
}

function exampleDetail(a: Bucket) {
  const ex = a.example?.hits?.hits?.[0]?._source?.friction?.detail;
  return ex ? ` Example: ${ex}` : "";
}

export function zeroResultEvidence(queries: Bucket[]): Evidence[] {
  return queries.flatMap((q) =>
    (q.by_actor?.buckets ?? []).map((a: Bucket) => ({
      text: `${a.key} shoppers searched for "${q.key}" ${a.doc_count} times and the shop returned no products.`,
      weight: a.doc_count,
      actor: a.key,
      source: "friction" as const,
    })),
  );
}

export function pathEvidence(paths: Bucket[]): Evidence[] {
  return paths.map((p) => {
    const types = (p.by_type?.buckets ?? []).map((t: Bucket) => `${t.key} ×${t.doc_count}`).join(", ");
    return { text: `Agents hit friction ${p.doc_count} times on ${p.key} (${types}).`, weight: p.doc_count, actor: "agent", source: "friction" as const };
  });
}

// Sessions that fetched HTML pages but never made a single API call: they
// only ever saw the SPA shell, i.e. no products, prices or cart at all.
export function htmlOnlyEvidence(sessionsByActor: Bucket[]): Evidence[] {
  return sessionsByActor.flatMap((a) => {
    const sessions: Bucket[] = a.sessions?.buckets ?? [];
    const htmlOnly = sessions.filter((s) => (s.api?.doc_count ?? 0) === 0 && (s.pages?.doc_count ?? 0) > 0).length;
    if (htmlOnly === 0) return [];
    return [{
      text: `${htmlOnly} of ${sessions.length} ${a.key} sessions only fetched HTML pages and never called the API or ran JavaScript, so they received the empty single-page-app shell with no product content.`,
      weight: htmlOnly,
      actor: a.key,
      source: "traffic" as const,
    }];
  });
}

export function funnelEvidence(byActor: Bucket[]): Evidence[] {
  return byActor.map((a) => {
    const n = (action: string) => a.actions?.buckets?.find((b: Bucket) => b.key === action)?.doc_count ?? 0;
    const starts = n("session_start");
    const orders = n("order_completed");
    const rate = starts ? ((orders / starts) * 100).toFixed(1) : "0.0";
    return {
      text: `${a.key} funnel: ${starts} sessions, ${n("product_viewed")} product views, ${n("added_to_cart")} add-to-carts, ${orders} orders (${rate}% of sessions converted).`,
      weight: starts,
      actor: a.key,
      source: "funnel" as const,
    };
  });
}

export function reportEvidence(hits: any[]): Evidence[] {
  return hits.map((h) => {
    const s = h._source;
    return {
      text: `Agent trip report (${s.outcome?.status}, goal: "${s.agent?.goal}"): ${s.report?.raw}`,
      weight: 1,
      actor: "agent",
      source: "report" as const,
    };
  });
}
