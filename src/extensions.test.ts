import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeApi, runExtensions } from "./extensions";
import { SumEngine } from "./engine";

describe("extensions", () => {
  let mockEngine: any;

  beforeEach(() => {
    mockEngine = {
      setVariable: vi.fn(),
      addUnit: vi.fn(),
      addFunction: vi.fn(),
    };
  });

  describe("makeApi", () => {
    it("delegates setVariable to engine", () => {
      const api = makeApi(mockEngine as SumEngine);
      api.setVariable("myVar", 42);
      expect(mockEngine.setVariable).toHaveBeenCalledWith("myVar", 42);
    });

    it("delegates addUnit to engine", () => {
      const api = makeApi(mockEngine as SumEngine);
      const spec = { id: "testUnit", phrases: "tests", baseUnitId: "USD", ratio: 1 };
      api.addUnit(spec);
      expect(mockEngine.addUnit).toHaveBeenCalledWith(spec);
    });

    it("delegates addFunction to engine", () => {
      const api = makeApi(mockEngine as SumEngine);
      const spec = { id: "testFunc", phrases: "test" };
      const fn = () => 42;
      api.addFunction(spec, fn);
      expect(mockEngine.addFunction).toHaveBeenCalledWith(spec, fn);
    });
  });

  describe("runExtensions", () => {
    let consoleErrorSpy: any;

    beforeEach(() => {
      vi.stubGlobal("window", { __numi_api: undefined });
      vi.stubGlobal("Blob", class Blob {
        parts: any[];
        options: any;
        constructor(parts: any[], options: any) { this.parts = parts; this.options = options; }
      });
      vi.stubGlobal("URL", {
        createObjectURL: vi.fn((blob: any) => "blob:" + blob.parts[0]),
        revokeObjectURL: vi.fn()
      });
      vi.stubGlobal("document", {
        createElement: vi.fn(() => ({ src: "", onload: null, onerror: null })),
        head: { appendChild: vi.fn((script: any) => {
          try {
            const code = script.src.replace(/^blob:/, "");
            eval(code);
            if (script.onload) script.onload();
          } catch(e) {
            if (script.onerror) script.onerror();
          }
        }) }
      });
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      consoleErrorSpy.mockRestore();
    });

    it("runs scripts successfully using numi api", async () => {
      const scripts = [
        {
          name: "script1",
          code: "numi.setVariable('var1', 10);",
        },
        {
          name: "script2",
          code: "numi.addUnit({ id: 'unit1', phrases: 'u', baseUnitId: 'USD', ratio: 1 });",
        },
      ];

      await runExtensions(mockEngine as SumEngine, scripts);

      expect(mockEngine.setVariable).toHaveBeenCalledWith("var1", 10);
      expect(mockEngine.addUnit).toHaveBeenCalledWith({ id: "unit1", phrases: "u", baseUnitId: "USD", ratio: 1 });
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("swallows errors and logs to console.error", async () => {
      const scripts = [
        {
          name: "script1",
          code: "throw new Error('test error');",
        },
      ];

      await runExtensions(mockEngine as SumEngine, scripts);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "extension script1 failed:",
        expect.any(Error)
      );
    });

    it("continues running other scripts if one fails", async () => {
      const scripts = [
        {
          name: "script1",
          code: "numi.setVariable('var1', 10);",
        },
        {
          name: "script2",
          code: "throw new Error('boom');",
        },
        {
          name: "script3",
          code: "numi.setVariable('var3', 30);",
        },
      ];

      await runExtensions(mockEngine as SumEngine, scripts);

      expect(mockEngine.setVariable).toHaveBeenCalledWith("var1", 10);
      expect(mockEngine.setVariable).toHaveBeenCalledWith("var3", 30);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
