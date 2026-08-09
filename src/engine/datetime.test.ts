import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectDateOrder,
  resolveZone,
  startOfToday,
  addToDate,
  isCalendarUnit,
} from "./datetime";

describe("datetime", () => {
  describe("detectDateOrder", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should detect dmy (e.g. en-GB)", () => {
      expect(detectDateOrder("en-GB")).toBe("dmy");
    });

    it("should detect mdy (e.g. en-US)", () => {
      expect(detectDateOrder("en-US")).toBe("mdy");
    });

    it("should default to dmy if neither is found", () => {
      const mockFormatToParts = vi.fn().mockReturnValue([
        { type: "year", value: "2000" },
      ]);

      const mockDateTimeFormat = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => ({
        formatToParts: mockFormatToParts,
      }) as any);

      expect(detectDateOrder()).toBe("dmy");
      mockDateTimeFormat.mockRestore();
    });
  });

  describe("resolveZone", () => {
    it("should resolve 'local' to system timezone", () => {
      const mockResolvedOptions = vi.fn().mockReturnValue({ timeZone: "America/Los_Angeles" });
      const mockDateTimeFormat = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => ({
        resolvedOptions: mockResolvedOptions,
      }) as any);

      expect(resolveZone(["local"])).toBe("America/Los_Angeles");
      mockDateTimeFormat.mockRestore();
    });

    it("should resolve known abbreviations", () => {
      expect(resolveZone(["utc"])).toBe("UTC");
      expect(resolveZone(["est"])).toBe("America/New_York");
      expect(resolveZone(["pst"])).toBe("America/Los_Angeles");
      expect(resolveZone(["jst"])).toBe("Asia/Tokyo");
    });

    it("should resolve known cities", () => {
      expect(resolveZone(["new", "york"])).toBe("America/New_York");
      expect(resolveZone(["london"])).toBe("Europe/London");
      expect(resolveZone(["tokyo"])).toBe("Asia/Tokyo");
      expect(resolveZone(["buenos", "aires"])).toBe("America/Argentina/Buenos_Aires");
    });

    it("should resolve russian cities", () => {
      expect(resolveZone(["нью", "йорк"])).toBe("America/New_York");
      expect(resolveZone(["москва"])).toBe("Europe/Moscow");
    });

    it("should ignore punctuation and case", () => {
      expect(resolveZone(["New-York"])).toBe("America/New_York");
      expect(resolveZone(["LONdoN."])).toBe("Europe/London");
    });

    it("should resolve raw IANA timezone", () => {
      expect(resolveZone(["Europe", "Berlin"])).toBe("Europe/Berlin");
      expect(resolveZone(["America", "Argentina", "Mendoza"])).toBe("America/Argentina/Mendoza");
    });

    it("should return null for unknown timezones", () => {
      expect(resolveZone(["Unknown", "City"])).toBeNull();
      expect(resolveZone(["Invalid/Timezone"])).toBeNull();
    });
  });

  describe("startOfToday", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return midnight of the current day", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-05-15T14:30:00Z"));

      const expected = new Date("2024-05-15T14:30:00Z");
      expected.setHours(0, 0, 0, 0);

      expect(startOfToday()).toBe(expected.getTime());
    });
  });

  describe("addToDate", () => {
    it("should add days", () => {
      const ms = new Date("2024-01-01T12:00:00Z").getTime();
      const res = addToDate(ms, 5, "day");
      expect(new Date(res).toISOString()).toBe("2024-01-06T12:00:00.000Z");
    });

    it("should add weeks", () => {
      const ms = new Date("2024-01-01T12:00:00Z").getTime();
      const res = addToDate(ms, 2, "week");
      expect(new Date(res).toISOString()).toBe("2024-01-15T12:00:00.000Z");
    });

    it("should add months", () => {
      const ms = new Date("2024-01-15T12:00:00Z").getTime();
      const res = addToDate(ms, 2, "month");
      expect(new Date(res).toISOString()).toBe("2024-03-15T12:00:00.000Z");
    });

    it("should clamp end of month correctly", () => {
      const ms = new Date("2024-01-31T12:00:00Z").getTime();
      const res = addToDate(ms, 1, "month");
      // 2024 is a leap year, so Feb 29
      expect(new Date(res).toISOString()).toBe("2024-02-29T12:00:00.000Z");

      const ms2 = new Date("2023-01-31T12:00:00Z").getTime();
      const res2 = addToDate(ms2, 1, "month");
      // 2023 is not a leap year, so Feb 28
      expect(new Date(res2).toISOString()).toBe("2023-02-28T12:00:00.000Z");
    });

    it("should add years", () => {
      const ms = new Date("2024-01-15T12:00:00Z").getTime();
      const res = addToDate(ms, 3, "year");
      expect(new Date(res).toISOString()).toBe("2027-01-15T12:00:00.000Z");
    });

    it("should clamp end of month when adding years to leap day", () => {
      const ms = new Date("2024-02-29T12:00:00Z").getTime();
      const res = addToDate(ms, 1, "year");
      expect(new Date(res).toISOString()).toBe("2025-02-28T12:00:00.000Z");
    });

    it("should handle unit ids with prefixes", () => {
      const ms = new Date("2024-01-01T12:00:00Z").getTime();
      const res = addToDate(ms, 5, "unit:day");
      expect(new Date(res).toISOString()).toBe("2024-01-06T12:00:00.000Z");
    });

    it("should return original ms if amount is not an integer", () => {
      const ms = new Date("2024-01-01T12:00:00Z").getTime();
      const res = addToDate(ms, 1.5, "day");
      expect(res).toBe(ms);
    });

    it("should return original ms for unhandled units", () => {
      const ms = new Date("2024-01-01T12:00:00Z").getTime();
      const res = addToDate(ms, 1, "hour");
      expect(res).toBe(ms);
    });
  });

  describe("isCalendarUnit", () => {
    it("should return true for valid calendar units with integer amounts", () => {
      expect(isCalendarUnit("day", 1)).toBe(true);
      expect(isCalendarUnit("week", 5)).toBe(true);
      expect(isCalendarUnit("month", -2)).toBe(true);
      expect(isCalendarUnit("year", 10)).toBe(true);
      expect(isCalendarUnit("unit:day", 1)).toBe(true);
    });

    it("should return false for floating point amounts", () => {
      expect(isCalendarUnit("day", 1.5)).toBe(false);
      expect(isCalendarUnit("month", 0.5)).toBe(false);
    });

    it("should return false for non-calendar units", () => {
      expect(isCalendarUnit("hour", 1)).toBe(false);
      expect(isCalendarUnit("minute", 1)).toBe(false);
      expect(isCalendarUnit("unit:meter", 1)).toBe(false);
    });

    it("should handle edge cases for amount", () => {
      expect(isCalendarUnit("day", 0)).toBe(true);
      expect(isCalendarUnit("day", Number.MAX_SAFE_INTEGER)).toBe(true);
      expect(isCalendarUnit("day", Number.MIN_SAFE_INTEGER)).toBe(true);

      expect(isCalendarUnit("day", NaN)).toBe(false);
      expect(isCalendarUnit("day", Infinity)).toBe(false);
      expect(isCalendarUnit("day", -Infinity)).toBe(false);
    });

    it("should handle edge cases for unitId string format", () => {
      expect(isCalendarUnit("", 1)).toBe(false);
      expect(isCalendarUnit(":", 1)).toBe(false);

      // string.split(":") behavior:
      expect(isCalendarUnit("time:month", 1)).toBe(true);
      expect(isCalendarUnit(":day", 1)).toBe(true);
      expect(isCalendarUnit("day:", 1)).toBe(false);
      expect(isCalendarUnit("a:day:c", 1)).toBe(true);
    });

    it("should return false for case-sensitive mismatch", () => {
      expect(isCalendarUnit("Day", 1)).toBe(false);
      expect(isCalendarUnit("YEAR", 1)).toBe(false);
      expect(isCalendarUnit("MONTH", 1)).toBe(false);
    });
  });
});
