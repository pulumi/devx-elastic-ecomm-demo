// Builds the Kibana saved objects (data views, Lens panels, a saved search
// and two dashboards) as NDJSON for the saved-objects _import API. Written
// against the 8.8 saved-object format; Kibana migrates it forward on import.

const CORE = "8.8.0";

type Obj = { type: string; id: string; attributes: any; references: any[]; coreMigrationVersion: string; typeMigrationVersion: string };

export const DATA_VIEWS = {
  traffic: { id: "shopfront-traffic", title: "traffic-classification-*", name: "Shopfront · traffic" },
  lifecycle: { id: "shopfront-lifecycle", title: "user-lifecycle-events-*", name: "Shopfront · lifecycle events" },
  friction: { id: "shopfront-friction", title: "shop-friction-*", name: "Shopfront · friction" },
  reports: { id: "shopfront-agent-reports", title: "shop-agent-reports", name: "Shopfront · agent trip reports" },
} as const;
type DV = keyof typeof DATA_VIEWS;

function dataView(k: DV): Obj {
  const v = DATA_VIEWS[k];
  return {
    type: "index-pattern",
    id: v.id,
    attributes: { title: v.title, name: v.name, timeFieldName: "@timestamp" },
    references: [],
    coreMigrationVersion: CORE,
    typeMigrationVersion: "8.0.0",
  };
}

// ---- Lens columns -----------------------------------------------------------

type Col = Record<string, any>;
const kql = (query: string) => ({ query, language: "kuery" });

const count = (label: string, filter?: string): Col => ({
  label,
  customLabel: true,
  dataType: "number",
  operationType: "count",
  isBucketed: false,
  scale: "ratio",
  sourceField: "___records___",
  params: { emptyAsNull: true },
  ...(filter ? { filter: kql(filter) } : {}),
});

const uniqueCount = (field: string, label: string, filter?: string): Col => ({
  label,
  customLabel: true,
  dataType: "number",
  operationType: "unique_count",
  isBucketed: false,
  scale: "ratio",
  sourceField: field,
  params: { emptyAsNull: true },
  ...(filter ? { filter: kql(filter) } : {}),
});

const terms = (field: string, label: string, orderBy: string, size = 10): Col => ({
  label,
  customLabel: true,
  dataType: "string",
  operationType: "terms",
  isBucketed: true,
  scale: "ordinal",
  sourceField: field,
  params: { size, orderBy: { type: "column", columnId: orderBy }, orderDirection: "desc", otherBucket: false, missingBucket: false, parentFormat: { id: "terms" } },
});

const dateHistogram = (): Col => ({
  label: "@timestamp",
  dataType: "date",
  operationType: "date_histogram",
  isBucketed: true,
  scale: "interval",
  sourceField: "@timestamp",
  params: { interval: "auto", includeEmptyRows: true, dropPartials: false },
});

// ---- Lens visualisations ---------------------------------------------------

function lens(id: string, title: string, dv: DV, visualizationType: string, columns: Record<string, Col>, visualization: any, query = ""): Obj {
  return {
    type: "lens",
    id,
    attributes: {
      title,
      description: "",
      visualizationType,
      state: {
        datasourceStates: { formBased: { layers: { layer1: { columnOrder: Object.keys(columns), columns, incompleteColumns: {} } } } },
        visualization,
        query: kql(query),
        filters: [],
        adHocDataViews: {},
        internalReferences: [],
      },
    },
    references: [{ type: "index-pattern", id: DATA_VIEWS[dv].id, name: "indexpattern-datasource-layer-layer1" }],
    coreMigrationVersion: CORE,
    typeMigrationVersion: "8.9.0",
  };
}

const metric = (id: string, title: string, dv: DV, col: Col) =>
  lens(id, title, dv, "lnsMetric", { m: col }, { layerId: "layer1", layerType: "data", metricAccessor: "m" });

function bars(id: string, title: string, dv: DV, x: Col, split: Col | undefined, y: Col, seriesType: "bar_stacked" | "bar_horizontal_stacked" | "bar_horizontal", query = "") {
  const columns: Record<string, Col> = split ? { x, s: split, y } : { x, y };
  return lens(id, title, dv, "lnsXY", columns, {
    legend: { isVisible: true, position: "right" },
    valueLabels: "hide",
    preferredSeriesType: seriesType,
    layers: [{ layerId: "layer1", layerType: "data", seriesType, xAccessor: "x", ...(split ? { splitAccessor: "s" } : {}), accessors: ["y"] }],
  }, query);
}

function donut(id: string, title: string, dv: DV, group: Col, value: Col) {
  return lens(id, title, dv, "lnsPie", { g: group, v: value }, {
    shape: "donut",
    layers: [{ layerId: "layer1", layerType: "data", primaryGroups: ["g"], metrics: ["v"], numberDisplay: "percent", categoryDisplay: "default", legendDisplay: "default" }],
  });
}

function table(id: string, title: string, dv: DV, columns: Record<string, Col>, query = "") {
  return lens(id, title, dv, "lnsDatatable", columns, { layerId: "layer1", layerType: "data", columns: Object.keys(columns).map((columnId) => ({ columnId })) }, query);
}

// ---- Saved search (trip reports as a readable list) ---------------------------

function savedSearch(id: string, title: string, dv: DV, columns: string[]): Obj {
  return {
    type: "search",
    id,
    attributes: {
      title,
      description: "",
      columns,
      sort: [["@timestamp", "desc"]],
      kibanaSavedObjectMeta: {
        searchSourceJSON: JSON.stringify({ query: kql(""), filter: [], indexRefName: "kibanaSavedObjectMeta.searchSourceJSON.index" }),
      },
    },
    references: [{ name: "kibanaSavedObjectMeta.searchSourceJSON.index", type: "index-pattern", id: DATA_VIEWS[dv].id }],
    coreMigrationVersion: CORE,
    typeMigrationVersion: "8.0.0",
  };
}

// ---- Dashboards --------------------------------------------------------------

type Panel = { obj: Obj; x: number; y: number; w: number; h: number };

function dashboard(id: string, title: string, description: string, panels: Panel[]): Obj {
  const panelsJSON = panels.map((p, i) => ({
    type: p.obj.type,
    gridData: { x: p.x, y: p.y, w: p.w, h: p.h, i: `p${i}` },
    panelIndex: `p${i}`,
    embeddableConfig: {},
    panelRefName: `panel_p${i}`,
  }));
  return {
    type: "dashboard",
    id,
    attributes: {
      title,
      description,
      panelsJSON: JSON.stringify(panelsJSON),
      optionsJSON: JSON.stringify({ useMargins: true, syncColors: true, hidePanelTitles: false }),
      timeRestore: true,
      timeFrom: "now-24h",
      timeTo: "now",
      refreshInterval: { pause: false, value: 30_000 },
      kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({ query: kql(""), filter: [] }) },
    },
    references: panels.map((p, i) => ({ name: `p${i}:panel_p${i}`, type: p.obj.type, id: p.obj.id })),
    coreMigrationVersion: CORE,
    typeMigrationVersion: "8.9.0",
  };
}

export const DASHBOARD_IDS = { agents: "shopfront-agents-vs-humans", friction: "shopfront-agent-friction" } as const;

function agentsVsHumans(): Obj[] {
  const p = "shopfront-avh";
  const panels: Panel[] = [
    { obj: metric(`${p}-humans`, "Human sessions", "traffic", uniqueCount("session.id", "Human sessions", "traffic.actor : \"human\"")), x: 0, y: 0, w: 12, h: 7 },
    { obj: metric(`${p}-agents`, "AI agent sessions", "traffic", uniqueCount("session.id", "AI agent sessions", "traffic.actor : \"agent\"")), x: 12, y: 0, w: 12, h: 7 },
    { obj: metric(`${p}-bots`, "Bot sessions", "traffic", uniqueCount("session.id", "Bot sessions", "traffic.actor : \"bot\"")), x: 24, y: 0, w: 12, h: 7 },
    { obj: metric(`${p}-orders`, "Orders", "lifecycle", count("Orders", "event.action : \"order_completed\"")), x: 36, y: 0, w: 12, h: 7 },
    {
      obj: bars(`${p}-over-time`, "Requests over time by classification", "traffic", dateHistogram(), terms("traffic.classification", "Classification", "y", 6), count("Requests"), "bar_stacked"),
      x: 0, y: 7, w: 32, h: 14,
    },
    { obj: donut(`${p}-share`, "Share of sessions", "traffic", terms("traffic.actor", "Actor", "v", 3), uniqueCount("session.id", "Sessions")), x: 32, y: 7, w: 16, h: 14 },
    {
      obj: table(`${p}-funnel`, "Shopping funnel by actor", "lifecycle", {
        a: terms("traffic.actor", "Actor", "sessions", 3),
        sessions: count("Sessions started", "event.action : \"session_start\""),
        views: count("Product views", "event.action : \"product_viewed\""),
        carts: count("Added to cart", "event.action : \"added_to_cart\""),
        orders: count("Orders", "event.action : \"order_completed\""),
      }),
      x: 0, y: 21, w: 24, h: 10,
    },
    {
      obj: bars(`${p}-agent-names`, "Which agents are shopping", "traffic", terms("traffic.agent_name", "Agent", "y", 10), undefined, uniqueCount("session.id", "Sessions"), "bar_horizontal", "traffic.actor : \"agent\""),
      x: 24, y: 21, w: 24, h: 10,
    },
    {
      obj: bars(`${p}-paths`, "What each actor requests", "traffic", terms("url.path", "Path", "y", 12), terms("traffic.actor", "Actor", "y", 3), count("Requests"), "bar_horizontal_stacked"),
      x: 0, y: 31, w: 24, h: 14,
    },
    {
      obj: table(`${p}-scoring`, "Classifier vs. ground truth (synthetic traffic)", "traffic", {
        g: terms("traffic.ground_truth", "Generated by", "n", 5),
        c: terms("traffic.classification", "Classified as", "n", 6),
        r: terms("traffic.reason", "Reason", "n", 8),
        n: count("Requests"),
      }, "traffic.ground_truth : *"),
      x: 24, y: 31, w: 24, h: 14,
    },
  ];
  return [...panels.map((x) => x.obj), dashboard(DASHBOARD_IDS.agents, "Shopfront · Agents vs Humans", "Who is shopping: human vs AI agent vs bot traffic, classified at ingest by the traffic-classification pipeline.", panels)];
}

function agentFriction(): Obj[] {
  const p = "shopfront-fr";
  const search = savedSearch(`${p}-reports`, "Agent trip reports", "reports", ["outcome.status", "report.obstacles", "agent.goal", "report.raw"]);
  const panels: Panel[] = [
    { obj: metric(`${p}-agent-friction`, "Friction events · agents", "friction", count("Agent friction events", "traffic.actor : \"agent\"")), x: 0, y: 0, w: 12, h: 7 },
    { obj: metric(`${p}-human-friction`, "Friction events · humans", "friction", count("Human friction events", "traffic.actor : \"human\"")), x: 12, y: 0, w: 12, h: 7 },
    { obj: metric(`${p}-reports-n`, "Agent trip reports", "reports", count("Trip reports")), x: 24, y: 0, w: 12, h: 7 },
    { obj: metric(`${p}-reports-failed`, "Agent runs that failed", "reports", count("Failed runs", "outcome.success : false")), x: 36, y: 0, w: 12, h: 7 },
    {
      obj: bars(`${p}-by-type`, "Friction by type and actor", "friction", terms("friction.type", "Friction", "y", 10), terms("traffic.actor", "Actor", "y", 3), count("Events"), "bar_horizontal_stacked"),
      x: 0, y: 7, w: 24, h: 13,
    },
    {
      obj: bars(`${p}-over-time`, "Friction over time", "friction", dateHistogram(), terms("traffic.actor", "Actor", "y", 3), count("Events"), "bar_stacked"),
      x: 24, y: 7, w: 24, h: 13,
    },
    {
      obj: table(`${p}-zero`, "Searches that returned nothing", "friction", {
        q: terms("friction.search_query", "Search query", "n", 15),
        a: terms("traffic.actor", "Actor", "n", 3),
        n: count("Times"),
      }, "friction.type : \"zero_results\""),
      x: 0, y: 20, w: 24, h: 13,
    },
    {
      obj: bars(`${p}-obstacles`, "Obstacles named in agent trip reports", "reports", terms("report.obstacles", "Obstacle", "y", 12), undefined, count("Reports"), "bar_horizontal"),
      x: 24, y: 20, w: 24, h: 13,
    },
    {
      obj: table(`${p}-where`, "Where agents hit walls", "friction", {
        path: terms("url.path", "Path", "n", 12),
        t: terms("friction.type", "Friction", "n", 6),
        n: count("Events"),
      }, "traffic.actor : \"agent\""),
      x: 0, y: 33, w: 20, h: 14,
    },
    { obj: search, x: 20, y: 33, w: 28, h: 14 },
  ];
  return [...panels.map((x) => x.obj), dashboard(DASHBOARD_IDS.friction, "Shopfront · Agent Friction", "Where shoppers hit walls, split by human vs agent, plus what the LLM agents said got in their way.", panels)];
}

export function dashboardObjects(): Obj[] {
  return [...(Object.keys(DATA_VIEWS) as DV[]).map(dataView), ...agentsVsHumans(), ...agentFriction()];
}

export function toNdjson(objects: Obj[]) {
  return objects.map((o) => JSON.stringify(o)).join("\n") + "\n";
}
