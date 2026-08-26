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

class MockElement {
  public tagName: string;
  public className: string = "";
  public textContent: string = "";
  public value: string = "";
  public children: MockElement[] = [];
  public classList = {
    classes: new Set<string>(),
    add: (c: string) => this.classList.classes.add(c),
    remove: (c: string) => this.classList.classes.delete(c),
    contains: (c: string) => this.classList.classes.has(c),
  };
  public listeners: Record<string, Function[]> = {};
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};

  get innerHTML(): string {
    return this.children.map(c => c.innerHTML).join("");
  }

  set innerHTML(val: string) {
    if (val === "") {
      this.children = [];
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  constructor(tagName: string = "div") {
    this.tagName = tagName;
  }

  replaceChildren() {
    this.children = [];
  }

  appendChild(child: MockElement) {
    if (child.tagName === "fragment") {
      this.children.push(...child.children);
    } else {
      this.children.push(child);
    }
  }

  append(...children: MockElement[]) {
    for (const child of children) {
      if (child.tagName === "fragment") {
        this.children.push(...child.children);
      } else {
        this.children.push(child);
      }
    }
  }

  addEventListener(event: string, handler: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  trigger(event: string, eventObj: any = {}) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((handler) => handler(eventObj));
    }
  }

  querySelector(sel: string): MockElement | null {
    if (sel === ".search-item") {
      return this.children.find((c) => c.className === "search-item") || null;
    }
    return null;
  }

  focus = vi.fn();
  click = vi.fn();
}

import { initSearch } from "./search";
import { beforeEach, afterEach } from "vitest";

describe("initSearch", () => {
  let overlay: MockElement;
  let input: MockElement;
  let resultsEl: MockElement;

  beforeEach(() => {
    overlay = new MockElement("div");
    input = new MockElement("input");
    resultsEl = new MockElement("div");

    vi.stubGlobal("document", {
      querySelector: vi.fn((sel: string) => {
        if (sel === "#search-overlay") return overlay;
        if (sel === "#search-input") return input;
        if (sel === "#search-results") return resultsEl;
        return null;
      }),
      createElement: vi.fn((tagName: string) => new MockElement(tagName)),
      createDocumentFragment: vi.fn(() => new MockElement("fragment")),
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens search, clears input and focuses", () => {
    const deps = { t: vi.fn(), onOpen: vi.fn() } as unknown as SearchDeps;
    const ctrl = initSearch(deps);

    overlay.classList.add("hidden");
    input.value = "old query";
    resultsEl.appendChild(new MockElement("div"));

    ctrl.open();

    expect(overlay.classList.contains("hidden")).toBe(false);
    expect(input.value).toBe("");
    expect(input.focus).toHaveBeenCalled();
    expect(resultsEl.children.length).toBe(0);
  });

  it("handles input event, debounces, and displays empty state", () => {
    const deps = {
      t: vi.fn().mockReturnValue("No results found"),
      docs: () => [],
      engine: { evaluateExpression: vi.fn() },
      onOpen: vi.fn(),
    } as unknown as SearchDeps;

    const ctrl = initSearch(deps);
    ctrl.open();

    input.value = "nonexistent";
    input.trigger("input");

    expect(resultsEl.children.length).toBe(0);

    vi.advanceTimersByTime(150);

    expect(resultsEl.children.length).toBe(1);
    expect(resultsEl.children[0].className).toBe("search-empty");
    expect(resultsEl.children[0].textContent).toBe("No results found");
  });

  it("renders search hits and handles click", () => {
    const deps = {
      t: vi.fn(),
      docs: () => [
        { id: "1", title: "Doc 1", text: "Match text" }
      ],
      engine: { evaluateExpression: vi.fn() },
      onOpen: vi.fn(),
    } as unknown as SearchDeps;

    const ctrl = initSearch(deps);
    ctrl.open();

    input.value = "match";
    input.trigger("input");
    vi.advanceTimersByTime(150);

    expect(resultsEl.children.length).toBe(1);
    const item = resultsEl.children[0];
    expect(item.className).toBe("search-item");
    expect(item.children.length).toBe(2);
    expect(item.children[0].className).toBe("doc");
    expect(item.children[0].textContent).toBe("Doc 1");
    expect(item.children[1].className).toBe("line");
    expect(item.children[1].textContent).toBe("Match text");

    item.trigger("click");
    expect(deps.onOpen).toHaveBeenCalledWith("1", 1);
    expect(overlay.classList.contains("hidden")).toBe(true);
  });

  it("handles keyboard events correctly", () => {
    const deps = { t: vi.fn(), onOpen: vi.fn() } as unknown as SearchDeps;
    const ctrl = initSearch(deps);

    ctrl.open();
    expect(overlay.classList.contains("hidden")).toBe(false);

    input.trigger("keydown", { key: "Escape" });
    expect(overlay.classList.contains("hidden")).toBe(true);

    const clickSpy = vi.fn();
    const item = new MockElement("div");
    item.className = "search-item";
    item.click = clickSpy;
    resultsEl.appendChild(item);

    input.trigger("keydown", { key: "Enter" });
    expect(clickSpy).toHaveBeenCalled();
  });

  it("closes on overlay mousedown", () => {
    const deps = { t: vi.fn(), onOpen: vi.fn() } as unknown as SearchDeps;
    const ctrl = initSearch(deps);

    ctrl.open();
    expect(overlay.classList.contains("hidden")).toBe(false);

    overlay.trigger("mousedown", { target: overlay });
    expect(overlay.classList.contains("hidden")).toBe(true);
  });

  it("does not close if mousedown is on inner element", () => {
    const deps = { t: vi.fn(), onOpen: vi.fn() } as unknown as SearchDeps;
    const ctrl = initSearch(deps);

    ctrl.open();

    overlay.trigger("mousedown", { target: input }); // some other element
    expect(overlay.classList.contains("hidden")).toBe(false);
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
