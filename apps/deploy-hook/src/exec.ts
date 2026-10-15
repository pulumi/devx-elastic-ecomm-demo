import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export type Runner = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS ? `...[truncated]...\n${s.slice(-MAX_OUTPUT_CHARS)}` : s;
}

// Always execs with an argument array (never a shell string), so shell
// metacharacters in any argument (branch names, notes, etc.) can't be
// interpreted — this is what actually prevents shell injection here, not
// input validation alone.
export const realRunner: Runner = (cmd, args, opts = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: truncate(stdout), stderr: truncate(stderr) });
    });
  });
};
