import { localDay, periodBounds, ranker } from "../features/reports/salon-report.controller.js";

describe("salon report helpers", () => {
  describe("periodBounds", () => {
    // 2026-01-01T19:00Z is already 2026-01-02 in Asia/Kolkata (+05:30).
    const now = new Date("2026-01-01T19:00:00Z");

    it("anchors 'day' to the salon local day, not the server day", () => {
      expect(periodBounds("day", "Asia/Kolkata", undefined, undefined, now)).toEqual({
        start: "2026-01-02",
        end: "2026-01-02",
      });
      expect(periodBounds("day", "UTC", undefined, undefined, now)).toEqual({
        start: "2026-01-01",
        end: "2026-01-01",
      });
    });

    it("spans 7 days for a week and 30 for a month, inclusive", () => {
      expect(periodBounds("week", "UTC", undefined, undefined, now)).toEqual({
        start: "2025-12-26",
        end: "2026-01-01",
      });
      expect(periodBounds("month", "UTC", undefined, undefined, now)).toEqual({
        start: "2025-12-03",
        end: "2026-01-01",
      });
    });

    it("passes custom dates straight through", () => {
      expect(
        periodBounds("custom", "UTC", "2025-06-01", "2025-06-30", now)
      ).toEqual({ start: "2025-06-01", end: "2025-06-30" });
      expect(
        periodBounds("custom", "UTC", undefined, undefined, now)
      ).toEqual({ start: undefined, end: undefined });
    });
  });

  describe("ranker", () => {
    it("accumulates by key and ranks by amount or by count", () => {
      const rank = ranker();
      rank.add("a", "Haircut", 100, 1);
      rank.add("a", "Haircut", 50, 2);
      rank.add("b", "Shave", 120, 10);
      rank.add(null, "Ignored", 999, 999);
      rank.add(undefined, "Ignored", 999, 999);

      expect(rank.all()).toHaveLength(2);
      // Haircut wins on money (150 > 120); Shave wins on volume (10 > 3).
      expect(rank.top(5).map((row) => row.label)).toEqual(["Haircut", "Shave"]);
      expect(rank.topByCount(5).map((row) => row.label)).toEqual(["Shave", "Haircut"]);
      expect(rank.top(1)).toEqual([{ label: "Haircut", value: 150, count: 3 }]);
    });
  });

  describe("localDay", () => {
    it("formats in the salon timezone", () => {
      const instant = new Date("2026-03-14T20:30:00Z");
      expect(localDay(instant, "UTC")).toBe("2026-03-14");
      expect(localDay(instant, "Asia/Kolkata")).toBe("2026-03-15");
    });
  });
});
