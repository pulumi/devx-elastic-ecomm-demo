import { describe, expect, it } from "vitest";
import { computeSignature, isTimestampFresh, verifySignature } from "./auth.js";

describe("verifySignature", () => {
  const secret = "test-secret";
  const body = Buffer.from(JSON.stringify({ app: "web", ref: "main" }));

  it("accepts a correctly signed body", () => {
    const sig = computeSignature(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    const sig = computeSignature(body, "other-secret");
    expect(verifySignature(body, sig, secret)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const sig = computeSignature(body, secret);
    const tampered = Buffer.from(JSON.stringify({ app: "web", ref: "malicious-ref" }));
    expect(verifySignature(tampered, sig, secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    expect(verifySignature(body, "not-a-valid-signature", secret)).toBe(false);
  });
});

describe("isTimestampFresh", () => {
  it("accepts the current time", () => {
    expect(isTimestampFresh(String(Date.now()))).toBe(true);
  });

  it("rejects a timestamp from an hour ago", () => {
    expect(isTimestampFresh(String(Date.now() - 60 * 60 * 1000))).toBe(false);
  });

  it("rejects a timestamp from an hour in the future", () => {
    expect(isTimestampFresh(String(Date.now() + 60 * 60 * 1000))).toBe(false);
  });

  it("rejects a missing timestamp", () => {
    expect(isTimestampFresh(undefined)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(isTimestampFresh("not-a-number")).toBe(false);
  });
});
