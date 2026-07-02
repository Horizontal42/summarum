// CodeMirror editor wired to the engine: evaluates on change, highlights
// engine tokens, renders the results overlay, autocompletes phrases.
import { EditorView, ViewUpdate, Decoration, DecorationSet, keymap, drawSelection } from "@codemirror/view";
import { EditorState, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion, CompletionContext, CompletionResult, acceptCompletion } from "@codemirror/autocomplete";
import { SumEngine, LineResult } from "../engine";

export interface EditorCallbacks {
  onChange(text: string): void;
  onCopy(text: string): void;
  onResults(results: LineResult[]): void;
  /** 0-based inclusive line range of the selection, null when collapsed */
  onSelection(range: [number, number] | null): void;
}

const setResults = StateEffect.define<LineResult[]>();

const resultsField = StateField.define<LineResult[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setResults)) value = e.value;
    return value;
  },
});

function buildDecorations(state: EditorState): DecorationSet {
  const results = state.field(resultsField);
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  for (let i = 0; i < Math.min(results.length, doc.lines); i++) {
    const line = doc.line(i + 1);
    const r = results[i];
    if (r.kind === "header") {
      builder.add(line.from, line.from, Decoration.line({ class: "tok-header" }));
      continue;
    }
    const marks: { from: number; to: number; cls: string }[] = [];
    for (const tk of r.tokens) {
      let cls: string | null = null;
      switch (tk.t) {
        case "num": case "const": case "scale": cls = "tok-number"; break;
        case "unit": case "currency": case "repr": case "date": case "datelit": cls = "tok-unit"; break;
        case "op": case "conv": case "assign": case "pctop": case "percent": case "bang": cls = "tok-op"; break;
        case "func": case "agg": cls = "tok-var"; break;
        default: cls = null;
      }
      if (cls && tk.end > tk.start && line.from + tk.end <= line.to) {
        marks.push({ from: line.from + tk.start, to: line.from + tk.end, cls });
      }
    }
    if (r.commentStart !== null) {
      marks.push({ from: line.from + r.commentStart, to: line.to, cls: "tok-comment" });
    }
    marks.sort((a, b) => a.from - b.from);
    let last = line.from;
    for (const m of marks) {
      if (m.from < last) continue; // overlapping (comment vs tokens) — first wins
      builder.add(m.from, m.to, Decoration.mark({ class: m.cls }));
      last = m.to;
    }
  }
  return builder.finish();
}

const highlightField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(_value, tr) {
    return buildDecorations(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Highlights every occurrence of the variable under the cursor. */
function buildVarHighlight(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sel = state.selection.main;
  if (!sel.empty) return builder.finish();
  const text = state.doc.toString();
  // expand a word around the cursor
  const isWordCh = (ch: string) => /[\p{L}\d_]/u.test(ch);
  let a = sel.head;
  let b = sel.head;
  while (a > 0 && isWordCh(text[a - 1])) a--;
  while (b < text.length && isWordCh(text[b])) b++;
  if (a === b) return builder.finish();
  const word = text.slice(a, b);
  if (!/^[\p{L}_][\p{L}\d_]*$/u.test(word)) return builder.finish();
  // only highlight if the word is actually assigned somewhere in the document
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^\\s*${esc}\\s*=`, "mu").test(text)) return builder.finish();
  const re = new RegExp(`(?<![\\p{L}\\d_])${esc}(?![\\p{L}\\d_])`, "gu");
  for (const m of text.matchAll(re)) {
    builder.add(m.index, m.index + word.length, Decoration.mark({ class: "tok-var-active" }));
  }
  return builder.finish();
}

const varHighlightField = StateField.define<DecorationSet>({
  create: buildVarHighlight,
  update(_value, tr) {
    return buildVarHighlight(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildSparkline(pts: number[], top: number): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const W = 80, H = 20, pad = 2;
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.classList.add("result-sparkline");
  svg.style.top = `${top}px`;
  const min = Math.min(...pts), max = Math.max(...pts);
  if (min === max) {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", String(pad));
    line.setAttribute("y1", String(H / 2));
    line.setAttribute("x2", String(W - pad));
    line.setAttribute("y2", String(H / 2));
    line.setAttribute("stroke", "var(--result)");
    line.setAttribute("stroke-width", "1.5");
    svg.appendChild(line);
  } else {
    const coords = pts.map((v, i) => {
      const x = pad + (i / (pts.length - 1)) * (W - 2 * pad);
      const y = pad + (1 - (v - min) / (max - min)) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const poly = document.createElementNS(NS, "polyline");
    poly.setAttribute("points", coords);
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "var(--result)");
    poly.setAttribute("stroke-width", "1.5");
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    svg.appendChild(poly);
    const last = pts[pts.length - 1];
    const cx = (W - pad).toFixed(1);
    const cy = (pad + (1 - (last - min) / (max - min)) * (H - 2 * pad)).toFixed(1);
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
    dot.setAttribute("r", "2");
    dot.setAttribute("fill", "var(--result)");
    svg.appendChild(dot);
  }
  return svg;
}

export class SumEditor {
  view: EditorView;
  private resultsEl: HTMLElement;
  private results: LineResult[] = [];

  constructor(
    parent: HTMLElement,
    resultsEl: HTMLElement,
    private engine: SumEngine,
    private cb: EditorCallbacks,
    private evaluateDoc: (text: string) => LineResult[],
    initialText: string,
  ) {
    this.resultsEl = resultsEl;

    let engineOptions: { label: string; type: string; detail?: string }[] | null = null;
    const completionSource = (ctx: CompletionContext): CompletionResult | null => {
      const word = ctx.matchBefore(/[\p{L}_]+$/u);
      if (!word || (word.from === word.to && !ctx.explicit)) return null;
      if (word.to - word.from < 2 && !ctx.explicit) return null;
      // the engine's phrase list is fixed after boot — map it once
      engineOptions ??= this.engine.completions().map((c) => ({
        label: c.label,
        type: c.type === "function" ? "function" : c.type === "keyword" ? "keyword" : "constant",
        detail: c.detail,
      }));
      const options = [...engineOptions];
      // document variables
      const text = ctx.state.doc.toString();
      for (const m of text.matchAll(/^\s*([\p{L}_][\p{L}\d_]*)\s*=/gmu)) {
        options.push({ label: m[1], type: "variable" });
      }
      return { from: word.from, options, validFor: /^[\p{L}_]*$/u };
    };

    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          autocompletion({ override: [completionSource], activateOnTyping: true, defaultKeymap: false }),
          keymap.of([{ key: "Tab", run: acceptCompletion }]),
          resultsField,
          highlightField,
          varHighlightField,
          EditorView.lineWrapping,
          drawSelection({ cursorBlinkRate: 1000 }),
          // CM injects its base styles at runtime after app.css, so layout
          // and cursor styling must live in a theme to take precedence
          EditorView.theme({
            ".cm-content": {
              // --results-width lives on #editor-wrap; the divider drags it
              paddingRight: "var(--results-width, 42%)",
              paddingLeft: "16px",
              overflowWrap: "anywhere",
            },
            ".cm-cursor, .cm-dropCursor": {
              borderLeft: "2px solid var(--caret)",
            },
          }),
          EditorView.updateListener.of((u: ViewUpdate) => {
            if (u.docChanged) {
              const text = u.state.doc.toString();
              this.evaluate(text);
              this.cb.onChange(text);
            }
            if (u.geometryChanged || u.viewportChanged || u.docChanged) {
              this.renderResults();
            }
            if (u.selectionSet || u.docChanged) {
              const sel = u.state.selection.main;
              if (sel.empty) {
                this.cb.onSelection(null);
              } else {
                const from = u.state.doc.lineAt(sel.from).number - 1;
                const to = u.state.doc.lineAt(sel.to).number - 1;
                this.cb.onSelection([from, to]);
              }
            }
          }),
        ],
      }),
    });

    this.evaluate(initialText);
    requestAnimationFrame(() => this.renderResults());
    this.view.scrollDOM.addEventListener("scroll", () => this.renderResults());

    // copying whole lines also copies their results: "5+5 = 10";
    // a partial single-line selection copies as usual
    this.view.dom.addEventListener("copy", (e) => {
      const state = this.view.state;
      const sel = state.selection.main;
      const doc = state.doc;
      const lineFrom = doc.lineAt(sel.from);
      const lineTo = doc.lineAt(sel.to);
      const multiLine = lineFrom.number !== lineTo.number;
      const coversLine = sel.from <= lineFrom.from && sel.to >= lineTo.to && !sel.empty;
      if (!sel.empty && !multiLine && !coversLine) return;
      const lines: string[] = [];
      for (let n = lineFrom.number; n <= lineTo.number; n++) {
        const line = doc.line(n);
        const res = this.results[n - 1]?.text;
        lines.push(res ? `${line.text} = ${res}` : line.text);
      }
      e.clipboardData?.setData("text/plain", lines.join("\n"));
      e.preventDefault();
    });

    this.resultsEl.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest(".result-line") as HTMLElement | null;
      if (el?.dataset.value) this.cb.onCopy(el.dataset.value);
    });
  }

  setText(text: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
    });
  }

  getText(): string {
    return this.view.state.doc.toString();
  }

  /** whole sheet with results appended: for Ctrl+Shift+C export */
  getSheetWithResults(): string {
    const doc = this.view.state.doc;
    const lines: string[] = [];
    for (let n = 1; n <= doc.lines; n++) {
      const res = this.results[n - 1]?.text;
      const text = doc.line(n).text;
      lines.push(res ? `${text} = ${res}` : text);
    }
    return lines.join("\n");
  }

  /** re-evaluate with current engine state (settings/rates changed) */
  refresh(): void {
    this.evaluate(this.getText());
    this.renderResults();
  }

  focus(): void {
    this.view.focus();
  }

  /** put the caret on line n (1-based) and scroll it into view */
  goToLine(n: number): void {
    const doc = this.view.state.doc;
    const line = doc.line(Math.min(Math.max(n, 1), doc.lines));
    this.view.dispatch({
      selection: { anchor: line.from, head: line.to },
      scrollIntoView: true,
    });
    this.view.focus();
  }

  private evaluate(text: string): void {
    this.results = this.evaluateDoc(text);
    this.view.dispatch({ effects: setResults.of(this.results) });
    this.cb.onResults(this.results);
  }

  private renderResults(): void {
    const frag = document.createDocumentFragment();
    const doc = this.view.state.doc;
    const overlayTop = this.resultsEl.getBoundingClientRect().top;
    const docTop = this.view.documentTop;
    for (let i = 0; i < Math.min(this.results.length, doc.lines); i++) {
      const r = this.results[i];
      const isChart = r.value?.kind === "chart";
      const isError = !!r.error;
      if (!r.text && !isChart && !isError) continue;
      const line = doc.line(i + 1);
      const block = this.view.lineBlockAt(line.from);
      const top = docTop + block.top - overlayTop;
      if (top < -40 || top > this.resultsEl.clientHeight + 40) continue;
      if (isChart && r.value?.kind === "chart") {
        frag.appendChild(buildSparkline(r.value.points.map((p) => p.toNumber()), top));
      } else {
        const el = document.createElement("div");
        el.className = "result-line" + (isError ? " result-error" : "");
        el.textContent = isError ? "#ref?" : r.text;
        if (!isError) el.dataset.value = r.text!;
        if (isError) el.title = r.error!;
        el.style.top = `${top}px`;
        frag.appendChild(el);
      }
    }
    this.resultsEl.replaceChildren(frag);
  }
}
