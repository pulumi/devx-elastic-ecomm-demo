import { describe, expect, it } from "vitest";
import { formatCents } from "./money";

describe("formatCents", () => {
  it("formats whole dollars", () => {
    expect(formatCents(2800)).toBe("$28.00");
  });

  it("formats cents", () => {
    expect(formatCents(1999)).toBe("$19.99");
  });

  it("respects the currency code", () => {
    expect(formatCents(1000, "EUR")).toBe("€10.00");
  });
});
