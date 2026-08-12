import { describe, it, expect, vi } from "vitest";
import { SumEngine } from "../engine";
import { parseResultQuery, searchAllSheets, SearchDeps, SearchDoc } from "./search";
import { Workspace } from "../workspace";
import Decimal from "decimal.js";

describe("parseResultQuery", () => {
  const engine = new SumEngine();

  it("parses '>=' operator correctly", () => {
    const res = parseResultQuery(engine, ">= 100");
    expect(res).not.toBeNull();
    expect(res?.op).toBe(">=");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(100))).toBe(true);
    }
  });

  it("parses '<=' operator correctly", () => {
    const res = parseResultQuery(engine, "<= 50");
    expect(res).not.toBeNull();
    expect(res?.op).toBe("<=");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(50))).toBe(true);
    }
  });

  it("parses '>' operator correctly", () => {
    const res = parseResultQuery(engine, "> 0");
    expect(res).not.toBeNull();
    expect(res?.op).toBe(">");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(0))).toBe(true);
    }
  });

  it("parses '<' operator correctly", () => {
    const res = parseResultQuery(engine, "< -10");
    expect(res).not.toBeNull();
    expect(res?.op).toBe("<");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(-10))).toBe(true);
    }
  });

  it("parses '=' operator correctly", () => {
    const res = parseResultQuery(engine, "= 42.5");
    expect(res).not.toBeNull();
    expect(res?.op).toBe("=");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(42.5))).toBe(true);
    }
  });

  it("parses '~' operator correctly", () => {
    const res = parseResultQuery(engine, "~ 3.14");
    expect(res).not.toBeNull();
    expect(res?.op).toBe("~");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(3.14))).toBe(true);
    }
  });

  it("handles whitespace correctly", () => {
    const res = parseResultQuery(engine, "   >=    200   ");
    expect(res).not.toBeNull();
    expect(res?.op).toBe(">=");
    expect(res?.threshold.kind).toBe("quantity");
    if (res?.threshold.kind === "quantity") {
      expect(res.threshold.value.eq(new Decimal(200))).toBe(true);
    }
  });

  it("returns null for invalid operator", () => {
    const res = parseResultQuery(engine, "!= 100");
    expect(res).toBeNull();
  });

  it("returns null for invalid value string", () => {
    // "abc" cannot be evaluated to a quantity
    const res = parseResultQuery(engine, ">= abc");
    expect(res).toBeNull();
  });

  it("returns null for empty string", () => {
    const res = parseResultQuery(engine, "");
    expect(res).toBeNull();
  });

  it("returns null when no expression matches after operator", () => {
    const res = parseResultQuery(engine, ">=");
    expect(res).toBeNull();
  });
});

describe("searchAllSheets", () => {
  it("returns empty array for empty query", () => {
    const deps = {} as SearchDeps;
    expect(searchAllSheets(deps, "   ")).toEqual([]);
  });

  it("performs full-text search across multiple sheets", () => {
    const docs: SearchDoc[] = [
      { id: "1", title: "Doc 1", text: "Hello world\nThis is a test" },
      { id: "2", title: "Doc 2", text: "Another test\nNothing here" },
    ];
    const deps = {
      docs: () => docs,
      engine: new SumEngine(),
    } as SearchDeps;

    const hits = searchAllSheets(deps, "test");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ docId: "1", docTitle: "Doc 1", line: 2, text: "This is a test" });
    expect(hits[1]).toMatchObject({ docId: "2", docTitle: "Doc 2", line: 1, text: "Another test" });
  });

  it("limits results to 200 hits for text search", () => {
    const lines = Array(250).fill("test string");
    const docs: SearchDoc[] = [
      { id: "1", title: "Doc 1", text: lines.join("\n") },
    ];
    const deps = {
      docs: () => docs,
      engine: new SumEngine(),
    } as SearchDeps;

    const hits = searchAllSheets(deps, "test");
    expect(hits).toHaveLength(200);
  });

  describe("numeric threshold search", () => {
    const engine = new SumEngine();

    const createMockWorkspace = (results: any[]) => {
      return {
        getCachedResults: vi.fn().mockReturnValue(results)
      } as unknown as Workspace;
    };

    it("matches exact value (=)", () => {
      const docs: SearchDoc[] = [{ id: "1", title: "Doc 1", text: "100" }];
      const workspace = createMockWorkspace([{
        value: { kind: "quantity", value: new Decimal(100) },
        text: "100"
      }]);

      const deps = {
        docs: () => docs,
        engine,
        workspace,
      } as unknown as SearchDeps;

      const hits = searchAllSheets(deps, "= 100");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ docId: "1", line: 1, result: "100" });

      const noHits = searchAllSheets(deps, "= 99");
      expect(noHits).toHaveLength(0);
    });

    it("matches greater than (>)", () => {
      const docs: SearchDoc[] = [{ id: "1", title: "Doc 1", text: "150\n50" }];
      const workspace = createMockWorkspace([
        { value: { kind: "quantity", value: new Decimal(150) }, text: "150" },
        { value: { kind: "quantity", value: new Decimal(50) }, text: "50" }
      ]);

      const deps = {
        docs: () => docs,
        engine,
        workspace,
      } as unknown as SearchDeps;

      const hits = searchAllSheets(deps, "> 100");
      expect(hits).toHaveLength(1);
      expect(hits[0].line).toBe(1);
    });

    it("matches approximate value (~)", () => {
      const docs: SearchDoc[] = [{ id: "1", title: "Doc 1", text: "100.5\n99.5\n105" }];
      const workspace = createMockWorkspace([
        { value: { kind: "quantity", value: new Decimal(100.5) }, text: "100.5" },
        { value: { kind: "quantity", value: new Decimal(99.5) }, text: "99.5" },
        { value: { kind: "quantity", value: new Decimal(105) }, text: "105" }
      ]);

      const deps = {
        docs: () => docs,
        engine,
        workspace,
      } as unknown as SearchDeps;

      const hits = searchAllSheets(deps, "~ 100");
      expect(hits).toHaveLength(2); // 100.5 and 99.5 are within 1% of 100
      expect(hits[0].line).toBe(1);
      expect(hits[1].line).toBe(2);
    });

    it("ignores non-quantity results during numeric search", () => {
      const docs: SearchDoc[] = [{ id: "1", title: "Doc 1", text: "100\nnot a number" }];
      const workspace = createMockWorkspace([
        { value: { kind: "quantity", value: new Decimal(100) }, text: "100" },
        { value: null, text: null }
      ]);

      const deps = {
        docs: () => docs,
        engine,
        workspace,
      } as unknown as SearchDeps;

      const hits = searchAllSheets(deps, "> 50");
      expect(hits).toHaveLength(1);
    });

    it("limits results to 200 hits for numeric search", () => {
      const lines = Array(250).fill("100");
      const docs: SearchDoc[] = [{ id: "1", title: "Doc 1", text: lines.join("\n") }];

      const results = Array(250).fill({
        value: { kind: "quantity", value: new Decimal(100) },
        text: "100"
      });
      const workspace = createMockWorkspace(results);

      const deps = {
        docs: () => docs,
        engine,
        workspace,
      } as unknown as SearchDeps;

      const hits = searchAllSheets(deps, "> 50");
      expect(hits).toHaveLength(200);
    });
  });
});
