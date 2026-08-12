import { logger } from "./logger";
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
    let consoleWarnSpy: any;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      vi.resetModules();
      vi.doUnmock("quickjs-emscripten-core");
    });

    it("runs scripts successfully using numi api", async () => {
      await runExtensions(mockEngine as SumEngine, [
        { name: "script1", code: "numi.setVariable('var1', 10);" },
        { name: "script2", code: "numi.addUnit({ id: 'unit1', phrases: 'u', baseUnitId: 'USD', ratio: 1 });" },
      ]);

      expect(mockEngine.setVariable).toHaveBeenCalledWith("var1", 10);
      expect(mockEngine.addUnit).toHaveBeenCalledWith({
        id: "unit1",
        phrases: "u",
        baseUnitId: "USD",
        ratio: 1,
      });
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("swallows errors and logs to console.error", async () => {
      await runExtensions(mockEngine as SumEngine, [{ name: "script1", code: "throw new Error('test error');" }]);

      expect(consoleErrorSpy).toHaveBeenCalledWith("extension script1 failed:", expect.any(Error));
      expect(consoleErrorSpy.mock.calls[0][1].message).toContain("test error");
    });

    it("continues running other scripts if one fails", async () => {
      await runExtensions(mockEngine as SumEngine, [
        { name: "script1", code: "numi.setVariable('var1', 10);" },
        { name: "script2", code: "throw new Error('boom');" },
        { name: "script3", code: "numi.setVariable('var3', 30);" },
      ]);

      expect(mockEngine.setVariable).toHaveBeenCalledWith("var1", 10);
      expect(mockEngine.setVariable).toHaveBeenCalledWith("var3", 30);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("passes unit-carrying values through setVariable", async () => {
      await runExtensions(mockEngine as SumEngine, [
        { name: "s", code: "numi.setVariable('rent', { double: 1200, unitId: 'USD' });" },
      ]);

      expect(mockEngine.setVariable).toHaveBeenCalledWith("rent", { double: 1200, unitId: "USD" });
    });

    it("rejects malformed api arguments as a script error", async () => {
      await runExtensions(mockEngine as SumEngine, [{ name: "bad", code: "numi.setVariable('x', 'nope');" }]);

      expect(mockEngine.setVariable).not.toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][1].message).toContain("numi.setVariable");
    });

    it("registers a function callable with one array of values", async () => {
      await runExtensions(mockEngine as SumEngine, [
        {
          name: "hyp",
          code: "numi.addFunction({ id: 'hyp', phrases: 'hyp' }, function (values) { return { double: Math.hypot(values[0].double, values[1].double) }; });",
        },
      ]);

      expect(mockEngine.addFunction).toHaveBeenCalledWith({ id: "hyp", phrases: "hyp" }, expect.any(Function));
      const fn = mockEngine.addFunction.mock.calls[0][1];
      expect(fn([{ double: 3 }, { double: 4 }])).toEqual({ double: 5 });
      expect(fn([{ double: 6 }, { double: 8 }])).toEqual({ double: 10 });
    });

    it("marshals unitId into the sandbox and back out", async () => {
      await runExtensions(mockEngine as SumEngine, [
        {
          name: "echo",
          code: "numi.addFunction({ id: 'echo', phrases: 'echo' }, function (v) { return { double: v[0].double * 2, unitId: v[0].unitId }; });",
        },
      ]);

      const fn = mockEngine.addFunction.mock.calls[0][1];
      expect(fn([{ double: 5, unitId: "meter" }])).toEqual({ double: 10, unitId: "meter" });
    });

    it("has no host globals inside the sandbox", async () => {
      await runExtensions(mockEngine as SumEngine, [
        { name: "probe", code: "if (typeof window !== 'undefined' || typeof fetch !== 'undefined' || typeof console !== 'undefined') throw new Error('leak');" },
      ]);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("interrupts an infinite loop at load time", async () => {
      await runExtensions(mockEngine as SumEngine, [
        { name: "spin", code: "while (true) {}" },
        { name: "after", code: "numi.setVariable('ok', 1);" },
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toBe("extension spin failed:");
      // the runtime survives the interrupt and keeps loading scripts
      expect(mockEngine.setVariable).toHaveBeenCalledWith("ok", 1);
    });

    it("interrupts a hung function on every call, not just the first", async () => {
      await runExtensions(mockEngine as SumEngine, [
        {
          name: "spin",
          code: "numi.addFunction({ id: 'spin', phrases: 'spin' }, function () { while (true) {} });",
        },
        {
          name: "good",
          code: "numi.addFunction({ id: 'good', phrases: 'good' }, function (v) { return v[0].double + 1; });",
        },
      ]);

      const spin = mockEngine.addFunction.mock.calls[0][1];
      const good = mockEngine.addFunction.mock.calls[1][1];

      expect(() => spin([])).toThrow(/spin/);
      // deadline is re-armed per call: a second call still times out rather than
      // failing instantly, and an unrelated function still works afterwards
      expect(() => spin([])).toThrow(/spin/);
      expect(good([{ double: 1 }])).toBe(2);
    });

    it("surfaces a bad return value as a function error", async () => {
      await runExtensions(mockEngine as SumEngine, [
        { name: "bad", code: "numi.addFunction({ id: 'bad', phrases: 'bad' }, function () { return 'nope'; });" },
      ]);

      const fn = mockEngine.addFunction.mock.calls[0][1];
      expect(() => fn([])).toThrow(/bad/);
    });

    it("skips extensions when the sandbox fails to load", async () => {
      vi.resetModules();
      vi.doMock("quickjs-emscripten-core", () => ({
        newQuickJSWASMModuleFromVariant: () => Promise.reject(new Error("no WebAssembly")),
      }));
      const { runExtensions: run } = await import("./extensions");
      const { logger } = await import("./logger");
      consoleWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      await run(mockEngine as SumEngine, [{ name: "s", code: "numi.setVariable('x', 1);" }]);

      expect(mockEngine.setVariable).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "extensions disabled: QuickJS sandbox unavailable:",
        expect.any(Error),
      );
    });

    it("does not load the sandbox when there are no scripts", async () => {
      await runExtensions(mockEngine as SumEngine, []);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
