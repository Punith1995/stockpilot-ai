import { describe, expect, it } from "vitest";
import { chartFreshness, ageText } from "../lib/freshness";

describe("chart freshness", () => {
  it("labels a connected feed Live when the last bar is within two bar lengths", () => {
    expect(chartFreshness({ live: true, ageMs: 4 * 60_000, barMinutes: 5 }).text).toBe("Live");
  });
  it("labels a connected feed Delayed when the last bar is older than two bar lengths", () => {
    expect(chartFreshness({ live: true, ageMs: 30 * 60_000, barMinutes: 5 }).text).toBe("Delayed by 30 min");
    expect(chartFreshness({ live: true, ageMs: 5 * 3_600_000, barMinutes: 5 }).text).toBe("Delayed by 5 h");
  });
  it("never says Live or Delayed without a connected feed", () => {
    const r = chartFreshness({ live: false, ageMs: 60_000, barMinutes: 5 });
    expect(r.text).toBe("Not live · last bar 1 min old");
    expect(r.text).not.toMatch(/Live$|Delayed/);
  });
  it("formats ages in minutes, hours and days", () => {
    expect(ageText(null)).toBe("—");
    expect(ageText(2 * 86_400_000)).toBe("2 d");
  });
});
