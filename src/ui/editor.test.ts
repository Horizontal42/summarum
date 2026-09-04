import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocking SumEditor completely because CodeMirror UI interactions require a full DOM
// and this project prohibits jsdom/happy-dom.

// A minimal mock for EditorView so we don't load the real one
vi.mock("@codemirror/view", async (importOriginal) => {
  const actual: any = await importOriginal();
  const mockView = class MockEditorView {
    state = {
      doc: {
        toString: () => "mock text",
        lines: 2,
        line: (n: number) => ({ text: `line ${n}`, from: (n-1)*10, to: n*10 }),
        lineAt: () => ({ number: 1, from: 0, to: 10 }),
        length: 20,
        iterLines: () => ({ next: vi.fn().mockReturnValue({ done: true }) })
      },
      selection: { main: { empty: true, from: 0, to: 0 } },
      field: vi.fn().mockReturnValue([])
    };
    dom = { addEventListener: vi.fn() };
    scrollDOM = { addEventListener: vi.fn() };
    documentTop = 0;
    dispatch = vi.fn();
    focus = vi.fn();
    lineBlockAt = vi.fn().mockReturnValue({ top: 0 });
    constructor(config: any) {
      if (config.state?.doc !== undefined && typeof config.state.doc !== 'string') {
         this.state = config.state;
      }
    }
  };
  (mockView as any).decorations = { from: vi.fn() };
  (mockView as any).theme = vi.fn();
  (mockView as any).updateListener = { of: vi.fn() };
  (mockView as any).lineWrapping = {};

  return {
    ...actual,
    EditorView: mockView,
    ViewPlugin: { fromClass: vi.fn() },
    Decoration: { mark: vi.fn(), line: vi.fn(), none: [] },
    drawSelection: vi.fn(),
  };
});

vi.mock("@codemirror/state", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    EditorState: { create: vi.fn((config) => config) },
    StateEffect: { define: vi.fn(() => ({ of: vi.fn() })) },
    StateField: { define: vi.fn(() => ({})) },
    RangeSetBuilder: class {
      add = vi.fn();
      finish = vi.fn().mockReturnValue([]);
    }
  };
});

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: vi.fn(),
  historyKeymap: [],
}));

vi.mock("@codemirror/autocomplete", () => ({
  autocompletion: vi.fn(),
  acceptCompletion: vi.fn(),
}));

import { SumEditor } from "./editor";

describe("SumEditor", () => {
  let mockParent: any;
  let mockResultsEl: any;
  let mockEngine: any;
  let mockCb: any;
  let evaluateDoc: any;

  beforeEach(() => {
    mockParent = { appendChild: vi.fn() };
    mockResultsEl = {
      getBoundingClientRect: vi.fn().mockReturnValue({ top: 0, height: 100 }),
      clientHeight: 100,
      addEventListener: vi.fn(),
      replaceChildren: vi.fn(),
    };

    mockEngine = { completions: vi.fn().mockReturnValue([]) };
    mockCb = {
      onChange: vi.fn(),
      onCopy: vi.fn(),
      onResults: vi.fn(),
      onSelection: vi.fn(),
    };
    evaluateDoc = vi.fn().mockReturnValue([]);

    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        className: "",
        style: {},
        textContent: "",
        dataset: {},
        title: "",
      })),
      createDocumentFragment: vi.fn(() => ({
        appendChild: vi.fn(),
      })),
    });
    vi.stubGlobal("requestAnimationFrame", (cb: any) => cb());
    vi.stubGlobal("window", { requestAnimationFrame: (cb: any) => cb() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("can be instantiated", () => {
    const editor = new SumEditor(mockParent, mockResultsEl, mockEngine, mockCb, evaluateDoc, "test");
    expect(editor).toBeDefined();
    expect(evaluateDoc).toHaveBeenCalledWith("test");
  });

  it("setText updates the editor", () => {
    const editor = new SumEditor(mockParent, mockResultsEl, mockEngine, mockCb, evaluateDoc, "test");
    editor.setText("new test");
    expect(editor.view.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({ insert: "new test" })
    }));
  });

  it("getText retrieves the current document text", () => {
    const editor = new SumEditor(mockParent, mockResultsEl, mockEngine, mockCb, evaluateDoc, "test");
    expect(editor.getText()).toBe("mock text"); // From our mock
  });

  it("refresh re-evaluates the current text", () => {
    const editor = new SumEditor(mockParent, mockResultsEl, mockEngine, mockCb, evaluateDoc, "test");
    evaluateDoc.mockClear();
    editor.refresh();
    expect(evaluateDoc).toHaveBeenCalledWith("mock text");
  });

  it("focus sets focus on the view", () => {
    const editor = new SumEditor(mockParent, mockResultsEl, mockEngine, mockCb, evaluateDoc, "test");
    editor.focus();
    expect(editor.view.focus).toHaveBeenCalled();
  });

  it("goToLine scrolls to the correct line", () => {
    const editor = new SumEditor(mockParent, mockResultsEl, mockEngine, mockCb, evaluateDoc, "test");
    editor.goToLine(2);
    expect(editor.view.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.anything(),
      scrollIntoView: true
    }));
    expect(editor.view.focus).toHaveBeenCalled();
  });

  it("getSheetWithResults appends evaluated results to lines", () => {
    const mockResults = [{ text: "10" }, { text: "20" }];
    evaluateDoc.mockReturnValue(mockResults);
    const editor = new SumEditor(mockParent, mockResultsEl, mockEngine, mockCb, evaluateDoc, "test");

    // We mocked EditorView to return doc.lines = 2 and doc.line(n) = `line ${n}`
    const result = editor.getSheetWithResults();
    expect(result).toBe("line 1 = 10\nline 2 = 20");
  });
});
