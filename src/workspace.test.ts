import { describe, it, expect, vi } from "vitest";
import { SumEngine } from "./engine";
import { Workspace, SheetSource } from "./workspace";

function makeWorkspace(initial: Record<string, { title: string; text: string }>) {
  const engine = new SumEngine();
  const store = new Map(Object.entries(initial).map(([id, v]) => [id, { id, ...v }]));
  const sheets = (): SheetSource[] => [...store.values()];
  const ws = new Workspace(engine, sheets);
  return { engine, store, ws };
}

describe("Workspace exports", () => {
  it("exposes assigned variables, total and last through @Sheet.key", () => {
    const { ws } = makeWorkspace({
      budget: { title: "Budget", text: "rent = $500\nfood = $200" },
    });
    const r = ws.evaluateSheet("dash", "@Budget.rent\n@Budget.total\n@Budget.last");
    expect(r[0].text).toBe("$500");
    expect(r[1].text).toBe("$700");
    expect(r[2].text).toBe("$200");
  });

  it("caches a sheet's exports until invalidated", () => {
    const { ws, store } = makeWorkspace({
      budget: { title: "Budget", text: "rent = $500" },
    });
    expect(ws.evaluateSheet("dash", "@Budget.rent")[0].text).toBe("$500");
    store.get("budget")!.text = "rent = $900";
    expect(ws.evaluateSheet("dash", "@Budget.rent")[0].text).toBe("$500");
    ws.invalidate("budget");
    expect(ws.evaluateSheet("dash", "@Budget.rent")[0].text).toBe("$900");
  });

  it("evaluates a sheet lazily — only when it's actually referenced", () => {
    const { engine, ws } = makeWorkspace({
      never: { title: "Never", text: "1 + 1" },
    });
    const spy = vi.spyOn(engine, "evaluateDocument");
    ws.evaluateSheet("dash", "hello");
    expect(spy.mock.calls.some(([text]) => text === "1 + 1")).toBe(false);
    ws.evaluateSheet("dash", "@Never.total");
    expect(spy.mock.calls.some(([text]) => text === "1 + 1")).toBe(true);
  });
});

describe("Workspace invalidation", () => {
  it("invalidating a sheet also invalidates its dependents, not unrelated sheets", () => {
    const { ws, store } = makeWorkspace({
      a: { title: "A", text: "x = 10" },
      b: { title: "B", text: "z = @A.x" },
      c: { title: "C", text: "y = 5" },
    });
    expect(ws.evaluateSheet("dash", "@B.z")[0].text).toBe("10");
    expect(ws.evaluateSheet("dash", "@C.y")[0].text).toBe("5");

    store.get("a")!.text = "x = 99";
    expect(ws.evaluateSheet("dash", "@B.z")[0].text).toBe("10");

    ws.invalidate("a");
    expect(ws.evaluateSheet("dash", "@B.z")[0].text).toBe("99");
    expect(ws.evaluateSheet("dash", "@C.y")[0].text).toBe("5");
  });
});

describe("Workspace cycle detection", () => {
  it("a true two-sheet cycle terminates instead of looping forever", () => {
    const { ws } = makeWorkspace({
      a: { title: "A", text: "z = @B.total" },
      b: { title: "B", text: "z = @A.total" },
    });
    const r = ws.evaluateSheet("dash", "@A.z");
    expect(r[0].value).toBeNull();
    expect(r[0].error).toBeDefined();
  });

  it("a sheet referencing itself surfaces a circular reference immediately", () => {
    const { ws } = makeWorkspace({ self: { title: "Self", text: "" } });
    const text = "a = 5\nb = @Self.a";
    expect(() => ws.evaluateSheet("self", text)).not.toThrow();
    const r = ws.evaluateSheet("self", text);
    expect(r[1].value).toBeNull();
    expect(r[1].error).toBe("circular reference");
  });

  it("a two-sheet cycle reports a stable error across repeated queries (no stale cache poisoning)", () => {
    const { ws } = makeWorkspace({
      a: { title: "A", text: "z = @B.total" },
      b: { title: "B", text: "z = @A.total" },
    });
    const first = ws.evaluateSheet("dash", "@A.z");
    const second = ws.evaluateSheet("dash", "@A.z");
    expect(first[0].value).toBeNull();
    expect(second[0].value).toBeNull();
    expect(first[0].error).toBeDefined();
    expect(second[0].error).toBeDefined();
    expect(second[0].error).toBe(first[0].error);
  });
});

describe("Workspace.renameSheet", () => {
  it("rewrites bare-form references to the new title", () => {
    const { ws } = makeWorkspace({
      budget: { title: "Budget", text: "rent = $500" },
      dash: { title: "Dashboard", text: "@Budget.rent + 1" },
    });
    expect(ws.renameSheet("budget", "Budget", "Money")).toEqual([{ id: "dash", text: "@Money.rent + 1" }]);
  });

  it("switches to bracket form when the new title needs it", () => {
    const { ws } = makeWorkspace({
      budget: { title: "Budget", text: "rent = $500" },
      dash: { title: "Dashboard", text: "@Budget.rent" },
    });
    expect(ws.renameSheet("budget", "Budget", "Monthly Budget")).toEqual([
      { id: "dash", text: "@[Monthly Budget].rent" },
    ]);
  });

  it("rewrites existing bracket-form references too", () => {
    const { ws } = makeWorkspace({
      trip: { title: "Trip to Lisbon", text: "food = 25" },
      dash: { title: "Dashboard", text: "@[Trip to Lisbon].food" },
    });
    expect(ws.renameSheet("trip", "Trip to Lisbon", "Lisbon")).toEqual([{ id: "dash", text: "@Lisbon.food" }]);
  });

  it("never rewrites the renamed sheet's own text", () => {
    const { ws } = makeWorkspace({
      budget: { title: "Budget", text: "a = 1\nb = @Budget.a" },
    });
    expect(ws.renameSheet("budget", "Budget", "Money")).toEqual([]);
  });

  it("leaves unrelated sheets untouched", () => {
    const { ws } = makeWorkspace({
      budget: { title: "Budget", text: "rent = $500" },
      other: { title: "Other", text: "just text, no refs" },
    });
    expect(ws.renameSheet("budget", "Budget", "Money")).toEqual([]);
  });
});
