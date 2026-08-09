import { describe, it, expect, vi } from "vitest";

vi.mock("./vocab-data", () => ({
  EN: {
    "TestCategory": {
      "test_key.variants": "a, b, c ,a,  ",
      "test_key.format": "en_fmt",
      "test_key.suffix1": "val1",
      "test_key2.variants": "x,y",
      "test_key2.suffix1": "val2",
      "same.key": "duplicate",
    }
  },
  RU: {
    "TestCategory": {
      "test_key.variants": "d, b , e",
      "test_key.format": "ru_fmt",
      "test_key3.variants": "z",
      "test_key3.suffix2": "val3",
      "same.key": "duplicate",
    }
  }
}));

import { variants, entry, entryEn, entriesAll, idsOf, idsWithSuffix } from "./vocab";

describe("vocab", () => {
  describe("variants", () => {
    it("returns comma-split, trimmed, and deduped variants across locales", () => {
      // EN has "a", "b", "c", "a", "" (empty string trimmed out)
      // RU has "d", "b", "e"
      const res = variants("TestCategory", "test_key.variants");
      expect(res).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("returns empty array for unknown category or key", () => {
      expect(variants("UnknownCategory", "test_key.variants")).toEqual([]);
      expect(variants("TestCategory", "unknown_key.variants")).toEqual([]);
    });
  });

  describe("entry", () => {
    it("returns the first locale's value", () => {
      expect(entry("TestCategory", "test_key.format")).toBe("en_fmt");
    });

    it("returns undefined for unknown category or key", () => {
      expect(entry("UnknownCategory", "test_key.format")).toBeUndefined();
      expect(entry("TestCategory", "unknown_key")).toBeUndefined();
    });
  });

  describe("entryEn", () => {
    it("returns only the English value", () => {
      expect(entryEn("TestCategory", "test_key.format")).toBe("en_fmt");
    });

    it("returns undefined if only in RU", () => {
      expect(entryEn("TestCategory", "test_key3.variants")).toBeUndefined();
    });
  });

  describe("entriesAll", () => {
    it("returns all unique values across locales", () => {
      expect(entriesAll("TestCategory", "test_key.format")).toEqual(["en_fmt", "ru_fmt"]);
    });

    it("deduplicates values if they are the same in multiple locales", () => {
      expect(entriesAll("TestCategory", "same.key")).toEqual(["duplicate"]);
    });

    it("returns empty array for unknown category or key", () => {
      expect(entriesAll("UnknownCategory", "test_key.format")).toEqual([]);
    });
  });

  describe("idsOf", () => {
    it("returns all base keys ending in .variants across locales", () => {
      const res = idsOf("TestCategory");
      expect(res.sort()).toEqual(["test_key", "test_key2", "test_key3"].sort());
    });

    it("returns empty array for unknown category", () => {
      expect(idsOf("UnknownCategory")).toEqual([]);
    });
  });

  describe("idsWithSuffix", () => {
    it("returns all keys ending with the given suffix across locales", () => {
      const res1 = idsWithSuffix("TestCategory", ".suffix1");
      expect(res1.sort()).toEqual(["test_key", "test_key2"].sort());

      const res2 = idsWithSuffix("TestCategory", ".suffix2");
      expect(res2).toEqual(["test_key3"]);
    });

    it("returns empty array for unknown category or suffix", () => {
      expect(idsWithSuffix("UnknownCategory", ".suffix1")).toEqual([]);
      expect(idsWithSuffix("TestCategory", ".unknown_suffix")).toEqual([]);
    });
  });
});
