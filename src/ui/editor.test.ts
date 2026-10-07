import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SumEditor } from './editor';

vi.mock('@codemirror/view', () => {
  class MockEditorView {
    static updateListener = { of: vi.fn() };
    static theme = vi.fn();
    static lineWrapping = {};
    static decorations = { from: vi.fn() };

    state = {
      doc: {
        length: 10,
        toString: vi.fn(() => "mock doc"),
        lines: 2,
        line: vi.fn((n) => ({ text: `line ${n}`, from: (n-1)*10, to: n*10 })),
        lineAt: vi.fn((_pos) => ({ number: 1, from: 0, to: 10 })),
        iterLines: vi.fn(function*() { yield "line 1"; yield "line 2"; }),
      },
      selection: { main: { empty: true, from: 0, to: 0, head: 0 } },
    };
    dom = { addEventListener: vi.fn() };
    scrollDOM = { addEventListener: vi.fn() };
    dispatch = vi.fn();
    focus = vi.fn();
    lineBlockAt = vi.fn(() => ({ top: 10 }));
    documentTop = 0;

    constructor(config: any) {
      if (config.state?.doc) {
        this.state.doc.toString = vi.fn(() => config.state.doc);
      }
    }
  }

  return {
    EditorView: MockEditorView,
    ViewPlugin: { fromClass: vi.fn() },
    Decoration: { mark: vi.fn(), line: vi.fn(), none: {} },
    keymap: { of: vi.fn() },
    drawSelection: vi.fn(),
  };
});

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn((cfg) => cfg),
  },
  StateEffect: {
    define: vi.fn(() => ({ of: vi.fn() })),
  },
  StateField: {
    define: vi.fn(),
  },
  RangeSetBuilder: class {
    add = vi.fn();
    finish = vi.fn();
  },
}));

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: vi.fn(),
  historyKeymap: [],
}));

vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: vi.fn(),
  acceptCompletion: vi.fn(),
}));

describe('SumEditor', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: Function) => cb());
    vi.stubGlobal('document', {
      createDocumentFragment: vi.fn(() => ({
        appendChild: vi.fn(),
      })),
      createElement: vi.fn((tag) => ({
        tagName: tag,
        className: '',
        textContent: '',
        dataset: {},
        style: {},
      })),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createMocks = () => {
    const parent = { getBoundingClientRect: () => ({ top: 0 }) } as any;
    const resultsEl = {
      addEventListener: vi.fn(),
      replaceChildren: vi.fn(),
      getBoundingClientRect: () => ({ top: 0 }),
      clientHeight: 500,
    } as any;
    const engine = { completions: vi.fn(() => []) } as any;
    const cb = { onChange: vi.fn(), onCopy: vi.fn(), onResults: vi.fn(), onSelection: vi.fn() };
    const evaluateDoc = vi.fn(() => []);
    return { parent, resultsEl, engine, cb, evaluateDoc };
  };

  it('instantiates and triggers evaluation on init', () => {
    const { parent, resultsEl, engine, cb, evaluateDoc } = createMocks();
    const editor = new SumEditor(parent, resultsEl, engine, cb, evaluateDoc, 'init text');
    expect(editor).toBeDefined();
    expect(editor.getText()).toBe('init text');
    expect(evaluateDoc).toHaveBeenCalledWith('init text');
    expect(cb.onResults).toHaveBeenCalled();
  });

  it('setText dispatches changes to the view', () => {
    const { parent, resultsEl, engine, cb, evaluateDoc } = createMocks();
    const editor = new SumEditor(parent, resultsEl, engine, cb, evaluateDoc, '');
    editor.setText('new text');
    expect(editor.view.dispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 10, insert: 'new text' }
    });
  });

  it('refresh re-evaluates the current text and renders results', () => {
    const { parent, resultsEl, engine, cb, evaluateDoc } = createMocks();
    const editor = new SumEditor(parent, resultsEl, engine, cb, evaluateDoc, 'text');
    editor.refresh();
    expect(evaluateDoc).toHaveBeenCalledTimes(2); // init + refresh
  });

  it('focus focuses the view', () => {
    const { parent, resultsEl, engine, cb, evaluateDoc } = createMocks();
    const editor = new SumEditor(parent, resultsEl, engine, cb, evaluateDoc, '');
    editor.focus();
    expect(editor.view.focus).toHaveBeenCalled();
  });

  it('goToLine calculates correctly and dispatches selection', () => {
    const { parent, resultsEl, engine, cb, evaluateDoc } = createMocks();
    const editor = new SumEditor(parent, resultsEl, engine, cb, evaluateDoc, '');
    editor.goToLine(2);
    expect(editor.view.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 10, head: 20 },
      scrollIntoView: true
    });
    expect(editor.view.focus).toHaveBeenCalled();
  });

  it('getSheetWithResults formats lines with their results', () => {
    const { parent, resultsEl, engine, cb, evaluateDoc } = createMocks();
    // evaluateDoc will return mock results
    evaluateDoc.mockReturnValue([{ text: 'result 1', tokens: [] }, { text: 'result 2', tokens: [] }] as any);
    const editor = new SumEditor(parent, resultsEl, engine, cb, evaluateDoc, '');

    const sheet = editor.getSheetWithResults();
    // doc mock returns line 1 and line 2
    expect(sheet).toBe('line 1 = result 1\nline 2 = result 2');
  });
});
