import { init as initApm } from "@elastic/apm-rum";

// No-ops (returns undefined) when no Cloud APM server URL is configured at
// build time, so `npm run dev` works with zero Elastic setup.
const serverUrl = import.meta.env.VITE_ELASTIC_APM_SERVER_URL;

export const apm = serverUrl
  ? initApm({
      serviceName: "shopfront-web",
      serverUrl,
      environment: import.meta.env.MODE,
      distributedTracingOrigins: [import.meta.env.VITE_API_ORIGIN ?? window.location.origin],
    })
  : undefined;
