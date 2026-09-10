import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocking EditorView and extensions to avoid full DOM requirement
vi.mock("@codemirror/view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/view")>();
  return {
    ...actual,
    EditorView: class MockEditorView {
      static updateListener = { of: vi.fn((fn) => ({ type: "updateListener", fn })) };
      static theme = vi.fn(() => ({ type: "theme" }));
      static lineWrapping = { type: "lineWrapping" };
      static decorations = { from: vi.fn() };

      state: any;
      dispatch: any;
      dom: any;
      scrollDOM: any;
      focus: any;

      // Store constructor config to extract update listener
      config: any;

      constructor(config: any) {
        this.config = config;
        this.state = config.state;
        this.dom = { addEventListener: vi.fn() };
        this.scrollDOM = { addEventListener: vi.fn() };
        this.focus = vi.fn();

        this.dispatch = vi.fn((tr: any) => {
          let docChanged = false;
          let selectionSet = false;
          if (tr.changes) {
            this.state.doc = {
              ...this.state.doc,
              text: tr.changes.insert || "",
              toString: () => tr.changes.insert || "",
              length: (tr.changes.insert || "").length,
              lines: (tr.changes.insert || "").split('\n').length,
              line: (n: number) => {
                  const lines = (tr.changes.insert || "").split('\n');
                  return { text: lines[n-1] || "", from: 0, to: 0, number: n };
              },
              lineAt: (_pos: number) => ({ number: 1, from: 0, to: 0 }),
            };
            docChanged = true;
          }
          if (tr.selection) {
            selectionSet = true;
            this.state.selection = { main: { ...tr.selection, empty: tr.selection.anchor === tr.selection.head } };
          }
          if (tr.effects) {
             // effects
          }

          // trigger update listener if configured
          const updateListener = this.config.state.config?.extensions?.flat(10)?.find((e: any) => e?.type === "updateListener");
          if (updateListener && (docChanged || selectionSet)) {
              updateListener.fn({
                  view: this,
                  state: this.state,
                  docChanged,
                  selectionSet,
                  geometryChanged: false,
                  viewportChanged: false
              });
          }
        });
      }

      lineBlockAt() { return { top: 10 }; }
      get documentTop() { return 0; }
    },
    drawSelection: vi.fn(() => ({ type: "drawSelection" })),
    ViewPlugin: { fromClass: vi.fn(() => ({ type: "viewPlugin" })) },
    keymap: { of: vi.fn(() => ({ type: "keymap" })) },
  };
});

vi.mock("@codemirror/state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/state")>();
  return {
    ...actual,
    EditorState: {
      create: (config: any) => ({
        config, // Keep original config for tests
        doc: {
          text: config.doc || "",
          toString: () => config.doc || "",
          length: (config.doc || "").length,
          lines: (config.doc || "").split('\n').length,
          line: (n: number) => {
             const lines = (config.doc || "").split('\n');
             return { text: lines[n-1] || "", from: 0, to: 0, number: n };
          },
          lineAt: (_pos: number) => ({ number: 1, from: 0, to: 0 }),
          iterLines: function*() { yield config.doc; }
        },
        selection: { main: { empty: true, from: 0, to: 0 } },
        field: vi.fn(() => []),
      })
    },
    StateEffect: { define: vi.fn(() => ({ of: vi.fn() })) },
    StateField: { define: vi.fn(() => ({ type: "stateField" })) },
  };
});

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [], history: vi.fn(() => ({ type: "history" })), historyKeymap: []
}));

vi.mock("@codemirror/autocomplete", () => ({
  autocompletion: vi.fn(() => ({ type: "autocompletion" })),
  acceptCompletion: vi.fn(),
}));

import { SumEditor } from "./editor";
import { SumEngine } from "../engine";

describe("SumEditor", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createDocumentFragment: vi.fn(() => ({
        appendChild: vi.fn(),
      })),
      createElement: vi.fn(() => ({
        style: {},
        dataset: {}, // IMPORTANT: dataset needs to be initialized!
        classList: { add: vi.fn(), contains: vi.fn() },
      })),
    });
    vi.stubGlobal("requestAnimationFrame", (cb: Function) => cb());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should initialize with text and evaluate", () => {
    const parent = {} as HTMLElement;
    const resultsEl = {
      addEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0 })),
      clientHeight: 500,
      replaceChildren: vi.fn()
    } as unknown as HTMLElement;

    const engine = new SumEngine();
    const cb = {
      onChange: vi.fn(),
      onCopy: vi.fn(),
      onResults: vi.fn(),
      onSelection: vi.fn(),
    };

    const evaluateDoc = vi.fn((_text: string) => [{ text: "2", value: null, kind: "normal" as const, tokens: [], commentStart: null }]);

    const editor = new SumEditor(
      parent,
      resultsEl,
      engine,
      cb,
      evaluateDoc,
      "1 + 1"
    );

    expect(editor).toBeDefined();
    expect(editor.getText()).toBe("1 + 1");
    expect(evaluateDoc).toHaveBeenCalledWith("1 + 1");
    expect(cb.onResults).toHaveBeenCalledWith([expect.objectContaining({ text: "2" })]);
  });

  it("setText updates text and evaluates", () => {
    const parent = {} as HTMLElement;
    const resultsEl = {
      addEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0 })),
      clientHeight: 500,
      replaceChildren: vi.fn()
    } as unknown as HTMLElement;

    const engine = new SumEngine();
    const cb = {
      onChange: vi.fn(),
      onCopy: vi.fn(),
      onResults: vi.fn(),
      onSelection: vi.fn(),
    };

    const evaluateDoc = vi.fn((_text: string) => [{ text: "2", value: null, kind: "normal" as const, tokens: [], commentStart: null }]);

    const editor = new SumEditor(
      parent,
      resultsEl,
      engine,
      cb,
      evaluateDoc,
      "1 + 1"
    );

    editor.setText("2 + 2");
    expect(editor.getText()).toBe("2 + 2");
    expect(evaluateDoc).toHaveBeenCalledWith("2 + 2");
    expect(cb.onChange).toHaveBeenCalledWith("2 + 2");
  });

  it("getSheetWithResults returns text and results combined", () => {
    const parent = {} as HTMLElement;
    const resultsEl = {
      addEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0 })),
      clientHeight: 500,
      replaceChildren: vi.fn()
    } as unknown as HTMLElement;

    const engine = new SumEngine();
    const cb = {
      onChange: vi.fn(),
      onCopy: vi.fn(),
      onResults: vi.fn(),
      onSelection: vi.fn(),
    };

    const evaluateDoc = vi.fn((_text: string) => [{ text: "2", value: null, kind: "normal" as const, tokens: [], commentStart: null }]);

    const editor = new SumEditor(
      parent,
      resultsEl,
      engine,
      cb,
      evaluateDoc,
      "1 + 1"
    );

    const combined = editor.getSheetWithResults();
    expect(combined).toBe("1 + 1 = 2");
  });

  it("goToLine places cursor correctly", () => {
    const parent = {} as HTMLElement;
    const resultsEl = {
      addEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0 })),
      clientHeight: 500,
      replaceChildren: vi.fn()
    } as unknown as HTMLElement;

    const engine = new SumEngine();
    const cb = {
      onChange: vi.fn(),
      onCopy: vi.fn(),
      onResults: vi.fn(),
      onSelection: vi.fn(),
    };

    const evaluateDoc = vi.fn((_text: string) => [{ text: "2", value: null, kind: "normal" as const, tokens: [], commentStart: null }]);

    const editor = new SumEditor(
      parent,
      resultsEl,
      engine,
      cb,
      evaluateDoc,
      "1 + 1\n2 + 2"
    );

    editor.goToLine(2);
    expect(editor.view.focus).toHaveBeenCalled();
    expect(editor.view.dispatch).toHaveBeenCalledWith(expect.objectContaining({
       scrollIntoView: true
    }));
  });
});
