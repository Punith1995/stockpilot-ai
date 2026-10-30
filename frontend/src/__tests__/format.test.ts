import { describe, expect, it } from "vitest";
import { fmtMoney, fmtPct, REASON_LABELS } from "../lib/format";

describe("formatting", () => {
  it("formats rupees with Indian grouping", () => {
    expect(fmtMoney(100000)).toBe("₹1,00,000.00");
  });
  it("shows a dash for missing values instead of NaN", () => {
    expect(fmtMoney(null)).toBe("—");
    expect(fmtPct(undefined)).toBe("—");
  });
  it("labels every exit reason the backend can send", () => {
    for (const r of ["STOP", "TARGET", "EMA_CROSS_DOWN", "MAX_HOLD", "END_OF_DATA", "TRAIL_STOP", "EMERGENCY_FLATTEN"]) {
      expect(REASON_LABELS[r]).toBeTruthy();
    }
  });
});
