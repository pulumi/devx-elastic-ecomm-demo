import { randomUUID } from "node:crypto";
import type { DeployApp } from "./validate.js";

export type JobStatus =
  | "queued"
  | "checking_out"
  | "testing"
  | "building"
  | "deploying"
  | "health_checking"
  | "succeeded"
  | "failed";

export interface JobStep {
  name: string;
  command: string;
  code: number;
  ok: boolean;
  output: string;
  startedAt: string;
  finishedAt: string;
}

export interface Job {
  id: string;
  app: DeployApp;
  ref: string;
  requestedBy: string;
  notes?: string;
  status: JobStatus;
  steps: JobStep[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// In-memory, single-process job store — acceptable for a reference
// implementation (one deploy-hook instance, jobs are short-lived). A
// production version would use a durable queue so a restart mid-deploy
// doesn't lose track of what's running.
const jobs = new Map<string, Job>();

export function createJob(input: { app: DeployApp; ref: string; requestedBy: string; notes?: string }): Job {
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    ...input,
    status: "queued",
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function setStatus(id: string, status: JobStatus, error?: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (error) job.error = error;
}

export function appendStep(id: string, step: JobStep): void {
  const job = jobs.get(id);
  if (!job) return;
  job.steps.push(step);
  job.updatedAt = new Date().toISOString();
}

// Test-only escape hatch to avoid cross-test pollution of the module-level map.
export function _resetJobsForTests(): void {
  jobs.clear();
}
