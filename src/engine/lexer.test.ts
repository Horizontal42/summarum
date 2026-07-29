import { describe, it, expect } from "vitest";
import { lexLine } from "./lexer";
import { Decimal } from "./types";

describe("lexer", () => {
  describe("lexLine", () => {
    it("should lex words and symbols, ignoring spaces", () => {
      const result = lexLine("hello + world");
      expect(result).toEqual([
        { type: "word", raw: "hello", start: 0, end: 5 },
        { type: "sym", raw: "+", start: 6, end: 7 },
        { type: "word", raw: "world", start: 8, end: 13 },
      ]);
    });

    it("should lex ISO dates", () => {
      const result = lexLine("2024-12-31");
      expect(result).toEqual([
        { type: "date", raw: "2024-12-31", start: 0, end: 10, dateMs: new Date(2024, 11, 31).getTime() },
      ]);
    });

    it("should lex dmy dates", () => {
      const result = lexLine("31.12.2024");
      expect(result).toEqual([
        { type: "date", raw: "31.12.2024", start: 0, end: 10, dateMs: new Date(2024, 11, 31).getTime() },
      ]);
    });

    it("should lex ambiguous dates as dmy by default", () => {
      const result = lexLine("01/02/2024");
      expect(result).toEqual([
        { type: "date", raw: "01/02/2024", start: 0, end: 10, dateMs: new Date(2024, 1, 1).getTime() },
      ]);
    });

    it("should lex ambiguous dates as mdy if specified", () => {
      const result = lexLine("01/02/2024", "mdy");
      expect(result).toEqual([
        { type: "date", raw: "01/02/2024", start: 0, end: 10, dateMs: new Date(2024, 0, 2).getTime() },
      ]);
    });

    it("should fallback when invalid dates are encountered", () => {
      // 2026-13-45 is invalid as a date, should lex as numbers and syms
      const result = lexLine("2026-13-45");
      expect(result[0].type).toBe("num");
      expect(result[0].raw).toBe("2026");
      expect(result[1].type).toBe("sym");
      expect(result[1].raw).toBe("-");
    });

    it("should lex plain integers", () => {
      const result = lexLine("42");
      expect(result).toEqual([
        { type: "num", raw: "42", start: 0, end: 2, value: new Decimal("42"), repr: "decimal" },
      ]);
    });

    it("should lex decimal comma numbers", () => {
      const result = lexLine("42,5");
      expect(result).toEqual([
        { type: "num", raw: "42,5", start: 0, end: 4, value: new Decimal("42.5"), repr: "decimal" },
      ]);
    });

    it("should lex space-grouped numbers", () => {
      const result = lexLine("1 000 000,5");
      expect(result).toEqual([
        { type: "num", raw: "1 000 000,5", start: 0, end: 11, value: new Decimal("1000000.5"), repr: "decimal" },
      ]);
    });

    it("should lex comma-grouped numbers", () => {
      const result = lexLine("1,000,000.5");
      expect(result).toEqual([
        { type: "num", raw: "1,000,000.5", start: 0, end: 11, value: new Decimal("1000000.5"), repr: "decimal" },
      ]);
    });

    it("should lex numbers with leading dots", () => {
      const result = lexLine(".5");
      expect(result).toEqual([
        { type: "num", raw: ".5", start: 0, end: 2, value: new Decimal(".5"), repr: "decimal" },
      ]);
    });

    it("should lex base numbers (hex, bin, oct)", () => {
      const hex = lexLine("0xff");
      expect(hex[0]).toMatchObject({ type: "num", raw: "0xff", value: new Decimal(255), repr: "hex" });

      const bin = lexLine("0b1010");
      expect(bin[0]).toMatchObject({ type: "num", raw: "0b1010", value: new Decimal(10), repr: "binary" });

      const oct = lexLine("0o77");
      expect(oct[0]).toMatchObject({ type: "num", raw: "0o77", value: new Decimal(63), repr: "octal" });
    });

    it("should lex bare cross-references", () => {
      const result = lexLine("@sheet.key");
      expect(result).toEqual([
        { type: "xref", raw: "@sheet.key", start: 0, end: 10, sheet: "sheet", key: "key" },
      ]);
    });

    it("should lex bracketed cross-references", () => {
      const result = lexLine("@[my sheet].key");
      expect(result).toEqual([
        { type: "xref", raw: "@[my sheet].key", start: 0, end: 15, sheet: "my sheet", key: "key" },
      ]);
    });
  });
});
