// Full-text and numeric ("> 100", "~ 50") search across every open sheet.
// Owns the #search-overlay DOM and its own input debounce.
import { SumEngine, Value } from "../engine";
import { Workspace } from "../workspace";

export interface SearchHit {
  docId: string;
  docTitle: string;
  line: number;
  text: string;
  result?: string;
}

export interface SearchDoc {
  id: string;
  title: string;
  text: string;
}

export interface SearchDeps {
  engine: SumEngine;
  workspace: Workspace;
  docs(): SearchDoc[];
  t(key: string): string;
  /** switch to docId (if not already active) and put the caret on line (1-based) */
  onOpen(docId: string, line: number): void;
}

export interface SearchController {
  open(): void;
}

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function parseResultQuery(engine: SumEngine, q: string): { op: string; threshold: Value } | null {
  const m = /^(>=|<=|>|<|=|~)\s*(.+)$/.exec(q.trim());
  if (!m) return null;
  const v = engine.evaluateExpression(m[2].trim());
  if (!v || v.kind !== "quantity") return null;
  return { op: m[1], threshold: v };
}

function searchAllSheets(deps: SearchDeps, query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const docs = deps.docs();
  const rq = parseResultQuery(deps.engine, q);
  if (rq && rq.threshold.kind === "quantity") {
    const th = rq.threshold.value;
    const hits: SearchHit[] = [];
    for (const doc of docs) {
      const results = deps.workspace.evaluateSheet(doc.id, doc.text);
      const lines = doc.text.split("\n");
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r.value || r.value.kind !== "quantity") continue;
        const v = r.value.value;
        let match = false;
        switch (rq.op) {
          case ">":  match = v.gt(th); break;
          case ">=": match = v.gte(th); break;
          case "<":  match = v.lt(th); break;
          case "<=": match = v.lte(th); break;
          case "=":  match = v.eq(th); break;
          case "~":  match = !th.isZero() && v.minus(th).abs().div(th.abs()).lte(0.01); break;
        }
        if (match) {
          hits.push({ docId: doc.id, docTitle: doc.title, line: i + 1, text: lines[i] ?? "", result: r.text ?? undefined });
          if (hits.length >= 200) return hits;
        }
      }
    }
    return hits;
  }
  const ql = q.toLowerCase();
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(ql)) {
        hits.push({ docId: doc.id, docTitle: doc.title, line: i + 1, text: lines[i] });
        if (hits.length >= 200) return hits;
      }
    }
  }
  return hits;
}

export function initSearch(deps: SearchDeps): SearchController {
  const overlay = $("#search-overlay");
  const input = $<HTMLInputElement>("#search-input");
  const resultsEl = $("#search-results");

  function close(): void {
    overlay.classList.add("hidden");
  }

  function render(query: string, hits: SearchHit[]): void {
    resultsEl.replaceChildren();
    if (query.trim() && hits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = deps.t("searchEmpty");
      resultsEl.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const hit of hits) {
      const item = document.createElement("div");
      item.className = "search-item";
      const docEl = document.createElement("div");
      docEl.className = "doc";
      docEl.textContent = hit.docTitle;
      const lineEl = document.createElement("div");
      lineEl.className = "line";
      lineEl.textContent = hit.result ? `${hit.text} = ${hit.result}` : hit.text;
      item.append(docEl, lineEl);
      item.addEventListener("click", () => {
        deps.onOpen(hit.docId, hit.line);
        close();
      });
      frag.appendChild(item);
    }
    resultsEl.appendChild(frag);
  }

  // a numeric query re-evaluates every open sheet — debounce so fast typing
  // doesn't recompute the whole workspace on every keystroke
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    const q = input.value;
    searchTimer = setTimeout(() => render(q, searchAllSheets(deps, q)), 150);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "Enter") {
      resultsEl.querySelector<HTMLElement>(".search-item")?.click();
    }
  });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  return {
    open(): void {
      overlay.classList.remove("hidden");
      input.value = "";
      render("", []);
      input.focus();
    },
  };
}
