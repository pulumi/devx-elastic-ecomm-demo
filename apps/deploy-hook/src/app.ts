import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { isTimestampFresh, verifySignature } from "./auth.js";
import type { DeployHookConfig } from "./config.js";
import { createJob, getJob } from "./jobs.js";
import { runDeployPipeline, type PipelineDeps, realDeps } from "./pipeline.js";
import { ValidationError, parseDeployRequest } from "./validate.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function buildApp(config: DeployHookConfig, deps: PipelineDeps = realDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  // Capture the exact raw bytes for HMAC verification — the parsed/re-serialized
  // JSON object would not byte-for-byte match what the caller signed.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req: FastifyRequest, body: Buffer, done) => {
    req.rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString("utf-8")) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/deploy", async (req, reply) => {
    const signature = req.headers["x-signature-256"] as string | undefined;
    const timestamp = req.headers["x-timestamp"] as string | undefined;

    if (!isTimestampFresh(timestamp)) {
      return reply.code(401).send({ error: "stale_or_missing_timestamp" });
    }
    if (!verifySignature(req.rawBody ?? Buffer.alloc(0), signature, config.webhookSecret)) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    let parsed;
    try {
      parsed = parseDeployRequest(req.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: "invalid_request", detail: err.message });
      }
      throw err;
    }

    const job = createJob(parsed);

    // Ack immediately — the pipeline runs for minutes (checkout, CI gate,
    // build, deploy). The caller polls GET /deploy/:id for status.
    reply.code(202).send({ id: job.id, status: job.status });

    runDeployPipeline(job, config, deps).catch((err) => {
      req.log.error({ err, jobId: job.id }, "deploy pipeline crashed outside its own error handling");
    });
  });

  app.get("/deploy/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) return reply.code(404).send({ error: "not_found" });
    return job;
  });

  return app;
}
