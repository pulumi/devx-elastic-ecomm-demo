import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realRunner, type Runner } from "./exec.js";
import { appendStep, setStatus, type Job } from "./jobs.js";
import type { DeployApp } from "./validate.js";

export interface DeployConfig {
  gitRemote: string;
  sshUser?: string;
  sshHost?: string;
  sshPort?: string;
  healthcheckUrl?: string;
}

export interface PipelineDeps {
  runner: Runner;
  sleep: (ms: number) => Promise<void>;
  mkWorkDir: () => Promise<string>;
  rmWorkDir: (dir: string) => Promise<void>;
}

export const realDeps: PipelineDeps = {
  runner: realRunner,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  mkWorkDir: () => mkdtemp(join(tmpdir(), "shopfront-deploy-")),
  rmWorkDir: (dir) => rm(dir, { recursive: true, force: true }),
};

function targetApps(app: DeployApp): Exclude<DeployApp, "both">[] {
  return app === "both" ? ["web", "api"] : [app];
}

function dockerEnv(config: DeployConfig): NodeJS.ProcessEnv {
  if (!config.sshHost || !config.sshUser) return process.env;
  const port = config.sshPort ? `:${config.sshPort}` : "";
  return { ...process.env, DOCKER_HOST: `ssh://${config.sshUser}@${config.sshHost}${port}` };
}

class StepFailedError extends Error {}

export async function runDeployPipeline(job: Job, config: DeployConfig, deps: PipelineDeps = realDeps): Promise<void> {
  const workDir = await deps.mkWorkDir();

  const step = async (name: string, cmd: string, args: string[], opts?: Parameters<Runner>[2]) => {
    const startedAt = new Date().toISOString();
    const result = await deps.runner(cmd, args, opts);
    appendStep(job.id, {
      name,
      command: [cmd, ...args].join(" "),
      code: result.code,
      ok: result.code === 0,
      output: result.code === 0 ? result.stdout.slice(-2000) : `${result.stdout}\n${result.stderr}`,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    if (result.code !== 0) {
      throw new StepFailedError(`${name} failed (exit ${result.code})`);
    }
    return result;
  };

  try {
    setStatus(job.id, "checking_out");
    await step("git-clone", "git", ["clone", "--quiet", "--depth", "50", config.gitRemote, workDir]);
    await step("git-checkout", "git", ["checkout", "--quiet", job.ref], { cwd: workDir });

    setStatus(job.id, "testing");
    await step("npm-ci", "npm", ["ci"], { cwd: workDir });
    for (const app of targetApps(job.app)) {
      await step(`lint-${app}`, "npm", ["run", "lint", "-w", `apps/${app}`], { cwd: workDir });
      await step(`test-${app}`, "npm", ["run", "test", "-w", `apps/${app}`], { cwd: workDir });
      await step(`build-${app}`, "npm", ["run", "build", "-w", `apps/${app}`], { cwd: workDir });
    }

    // CI gate passed — everything after this point actually touches the
    // deploy target. Nothing before this line ever runs docker or ssh.
    const env = dockerEnv(config);
    const shortRef = job.ref.slice(0, 12);

    setStatus(job.id, "building");
    for (const app of targetApps(job.app)) {
      await step(`docker-build-${app}`, "docker", ["build", "-t", `shopfront-${app}:${shortRef}`, "-f", `apps/${app}/Dockerfile`, "."], {
        cwd: workDir,
        env,
      });
    }

    setStatus(job.id, "deploying");
    await step(
      "docker-compose-up",
      "docker",
      ["compose", "-f", "docker-compose.prod.yml", "up", "-d", "--build", ...targetApps(job.app)],
      { cwd: workDir, env }
    );

    if (config.healthcheckUrl) {
      setStatus(job.id, "health_checking");
      await healthCheck(job, config.healthcheckUrl, deps);
    }

    setStatus(job.id, "succeeded");
  } catch (err) {
    setStatus(job.id, "failed", err instanceof Error ? err.message : String(err));
  } finally {
    await deps.rmWorkDir(workDir);
  }
}

async function healthCheck(job: Job, url: string, deps: PipelineDeps, tries = 10, intervalMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const startedAt = new Date().toISOString();
    const result = await deps.runner("curl", ["-sf", "-o", "/dev/null", "-w", "%{http_code}", url]);
    appendStep(job.id, {
      name: `healthcheck-${attempt}`,
      command: `curl ${url}`,
      code: result.code,
      ok: result.code === 0,
      output: result.stdout,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    if (result.code === 0) return;
    if (attempt < tries) await deps.sleep(intervalMs);
  }
  throw new StepFailedError(`health check against ${url} did not succeed after ${tries} attempts`);
}
