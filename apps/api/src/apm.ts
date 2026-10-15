export {};

// Must be imported first, before any other module, so the APM agent can
// instrument everything that loads after it. No-ops when no Cloud APM
// server URL is configured, so `npm run dev` works with zero Elastic setup.
if (process.env.ELASTIC_APM_SERVER_URL) {
  const apm = await import("elastic-apm-node");
  apm.default.start({
    serviceName: "shopfront-api",
    environment: process.env.NODE_ENV ?? "development",
    serverUrl: process.env.ELASTIC_APM_SERVER_URL,
    secretToken: process.env.ELASTIC_APM_SECRET_TOKEN,
  });
}
