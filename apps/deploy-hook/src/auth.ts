import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";
const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export function computeSignature(rawBody: Buffer, secret: string): string {
  return SIGNATURE_PREFIX + createHmac("sha256", secret).update(rawBody).digest("hex");
}

// Constant-time comparison so a caller can't learn the correct signature one
// byte at a time from response-time differences.
export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;

  const expected = computeSignature(rawBody, secret);
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signatureHeader);

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// Rejects requests whose timestamp is missing, malformed, or too old/too far
// in the future, so a captured request can't be replayed indefinitely.
export function isTimestampFresh(timestampHeader: string | undefined, toleranceMs = DEFAULT_TOLERANCE_MS): boolean {
  if (!timestampHeader) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;
  return Math.abs(Date.now() - timestamp) <= toleranceMs;
}
