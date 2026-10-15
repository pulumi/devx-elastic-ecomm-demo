import { beforeEach, describe, expect, it } from "vitest";
import { _resetJobsForTests, createJob, getJob } from "./jobs.js";
import { runDeployPipeline, type DeployConfig, type PipelineDeps } from "./pipeline.js";
import type { Runner } from "./exec.js";

function fakeDeps(runner: Runner): PipelineDeps {
  return {
    runner,
    sleep: async () => {},
    mkWorkDir: async () => "/tmp/fake-workdir",
    rmWorkDir: async () => {},
  };
}

function alwaysSucceeds(): Runner {
  return async () => ({ code: 0, stdout: "ok", stderr: "" });
}

function failsOn(match: (cmd: string, args: string[]) => boolean): Runner {
  return async (cmd, args) => {
    if (match(cmd, args)) return { code: 1, stdout: "", stderr: "boom" };
    return { code: 0, stdout: "ok", stderr: "" };
  };
}

const baseConfig: DeployConfig = { gitRemote: "https://example.com/shopfront.git" };

beforeEach(() => {
  _resetJobsForTests();
});

describe("runDeployPipeline", () => {
  it("succeeds end to end for a single app", async () => {
    const job = createJob({ app: "web", ref: "main", requestedBy: "test-harness" });
    await runDeployPipeline(job, baseConfig, fakeDeps(alwaysSucceeds()));

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("succeeded");
    const stepNames = finished.steps.map((s) => s.name);
    expect(stepNames).toEqual([
      "git-clone",
      "git-checkout",
      "npm-ci",
      "lint-web",
      "test-web",
      "build-web",
      "docker-build-web",
      "docker-compose-up",
    ]);
  });

  it("runs both apps' test and build steps when app is 'both'", async () => {
    const job = createJob({ app: "both", ref: "main", requestedBy: "test-harness" });
    await runDeployPipeline(job, baseConfig, fakeDeps(alwaysSucceeds()));

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("succeeded");
    const stepNames = finished.steps.map((s) => s.name);
    expect(stepNames).toContain("test-web");
    expect(stepNames).toContain("test-api");
    expect(stepNames).toContain("docker-build-web");
    expect(stepNames).toContain("docker-build-api");
  });

  it("stops before docker build/deploy when the CI gate fails", async () => {
    const job = createJob({ app: "web", ref: "main", requestedBy: "test-harness" });
    const runner = failsOn((cmd, args) => args.includes("test") && args.includes("-w"));
    await runDeployPipeline(job, baseConfig, fakeDeps(runner));

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("test-web failed");
    const stepNames = finished.steps.map((s) => s.name);
    expect(stepNames).not.toContain("docker-build-web");
    expect(stepNames).not.toContain("docker-compose-up");
  });

  it("marks the job failed if git checkout fails, before running npm at all", async () => {
    const job = createJob({ app: "web", ref: "nonexistent-branch", requestedBy: "test-harness" });
    const runner = failsOn((cmd) => cmd === "git");
    await runDeployPipeline(job, baseConfig, fakeDeps(runner));

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.steps.map((s) => s.name)).toEqual(["git-clone"]);
  });

  it("passes DOCKER_HOST when SSH config is present", async () => {
    const job = createJob({ app: "web", ref: "main", requestedBy: "test-harness" });
    const calls: { cmd: string; env?: NodeJS.ProcessEnv }[] = [];
    const runner: Runner = async (cmd, _args, opts) => {
      calls.push({ cmd, env: opts?.env });
      return { code: 0, stdout: "ok", stderr: "" };
    };

    const config: DeployConfig = { ...baseConfig, sshUser: "deploy", sshHost: "prod.example.com" };
    await runDeployPipeline(job, config, fakeDeps(runner));

    const dockerBuildCall = calls.find((c) => c.cmd === "docker");
    expect(dockerBuildCall?.env?.DOCKER_HOST).toBe("ssh://deploy@prod.example.com");
  });

  it("marks the job succeeded only after a passing health check", async () => {
    const job = createJob({ app: "web", ref: "main", requestedBy: "test-harness" });
    const config: DeployConfig = { ...baseConfig, healthcheckUrl: "http://prod.example.com/api/health" };
    await runDeployPipeline(job, config, fakeDeps(alwaysSucceeds()));

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("succeeded");
    expect(finished.steps.some((s) => s.name === "healthcheck-1")).toBe(true);
  });

  it("fails the job if the health check never passes", async () => {
    const job = createJob({ app: "web", ref: "main", requestedBy: "test-harness" });
    const config: DeployConfig = { ...baseConfig, healthcheckUrl: "http://prod.example.com/api/health" };
    const runner = failsOn((cmd) => cmd === "curl");
    await runDeployPipeline(job, config, fakeDeps(runner));

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("health check");
  });
});
