export type DeployApp = "web" | "api" | "both";

export interface DeployRequest {
  app: DeployApp;
  ref: string;
  requestedBy: string;
  notes?: string;
}

// A git ref/branch/sha handed to us over the network ends up as an argument
// to `git checkout` and `docker build`. Two risks: shell injection (mitigated
// separately by always exec'ing with an argument array, never a shell
// string) and git *argument* injection, where a ref like "--upload-pack=..."
// gets interpreted as a flag instead of a ref. Rejecting anything that
// doesn't match this allowlist, and anything starting with "-", closes both.
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export class ValidationError extends Error {}

export function parseDeployRequest(body: unknown): DeployRequest {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("request body must be a JSON object");
  }
  const { app, ref, requestedBy, notes } = body as Record<string, unknown>;

  if (app !== "web" && app !== "api" && app !== "both") {
    throw new ValidationError('"app" must be "web", "api", or "both"');
  }
  if (typeof ref !== "string" || !SAFE_REF.test(ref)) {
    throw new ValidationError('"ref" must be a valid branch name or commit sha');
  }
  if (typeof requestedBy !== "string" || requestedBy.trim().length === 0) {
    throw new ValidationError('"requestedBy" is required (identify the calling harness)');
  }
  if (notes !== undefined && typeof notes !== "string") {
    throw new ValidationError('"notes" must be a string if present');
  }

  return { app, ref, requestedBy, notes };
}
