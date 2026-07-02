// Owns the cross-sheet dependency graph: which sheets a `@Sheet.key`
// reference can see, cached exports, cycle detection, and rename rewrites.
// The engine has no concept of "other sheets" — that lives entirely here.
import type { SumEngine, LineResult } from "./engine";
import type { Value } from "./engine/types";
import type { XRefResolution } from "./engine/evaluator";

export interface SheetSource {
  id: string;
  title: string;
  text: string;
}

interface SheetExports {
  vars: Map<string, Value>;
  total: Value | null;
  last: Value | null;
}

const XREF_SCAN_RE = /@(?:\[([^\]]+)\]|([\p{L}_][\p{L}\d_]*))\./gu;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Workspace {
  private cache = new Map<string, SheetExports>();
  private resolving: string[] = [];

  constructor(private engine: SumEngine, private sheets: () => SheetSource[]) {}

  /** Evaluate a sheet as the user's active/open document — refs resolve live. */
  evaluateSheet(sheetId: string, text: string): LineResult[] {
    this.resolving.push(sheetId);
    try {
      return this.engine.evaluateDocument(text, (sheet, key) => this.resolveXRef(sheet, key));
    } finally {
      this.resolving.pop();
    }
  }

  /** Drop cached exports for a sheet and everything that transitively depends on it. */
  invalidate(sheetId: string): void {
    const dirty = new Set<string>([sheetId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of this.sheets()) {
        if (dirty.has(s.id)) continue;
        for (const title of this.referencedTitles(s.text)) {
          const target = this.findSheetByTitle(title);
          if (target && dirty.has(target.id)) {
            dirty.add(s.id);
            changed = true;
            break;
          }
        }
      }
    }
    for (const id of dirty) this.cache.delete(id);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Explicit rename: rewrite `@OldTitle.` / `@[Old Title].` to the new name
   * in every *other* sheet. Returns only the sheets whose text changed.
   */
  renameSheet(renamedId: string, oldTitle: string, newTitle: string): { id: string; text: string }[] {
    const oldEsc = escapeRegExp(oldTitle.trim());
    const bareRe = new RegExp(`@${oldEsc}\\.`, "gu");
    const bracketRe = new RegExp(`@\\[\\s*${oldEsc}\\s*\\]\\.`, "gu");
    const trimmedNew = newTitle.trim();
    const replacement = /^[\p{L}_][\p{L}\d_]*$/u.test(trimmedNew) ? `@${trimmedNew}.` : `@[${trimmedNew}].`;
    const out: { id: string; text: string }[] = [];
    for (const s of this.sheets()) {
      if (s.id === renamedId) continue;
      const rewritten = s.text.replace(bareRe, replacement).replace(bracketRe, replacement);
      if (rewritten !== s.text) out.push({ id: s.id, text: rewritten });
    }
    return out;
  }

  private referencedTitles(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(XREF_SCAN_RE)) out.push((m[1] ?? m[2]).trim());
    return out;
  }

  private findSheetByTitle(title: string): SheetSource | undefined {
    const needle = title.trim().toLowerCase();
    return this.sheets().find((s) => s.title.trim().toLowerCase() === needle);
  }

  private resolveXRef(sheetTitle: string, key: string): XRefResolution {
    const target = this.findSheetByTitle(sheetTitle);
    if (!target) return { ok: false, reason: `sheet "${sheetTitle}" not found` };
    if (this.resolving.includes(target.id)) {
      return { ok: false, reason: "circular reference" };
    }
    const exports = this.exportsFor(target);
    if (key === "total") {
      return exports.total
        ? { ok: true, value: exports.total }
        : { ok: false, reason: `sheet "${sheetTitle}" has no total` };
    }
    if (key === "last") {
      return exports.last
        ? { ok: true, value: exports.last }
        : { ok: false, reason: `sheet "${sheetTitle}" has no result` };
    }
    const v = exports.vars.get(key);
    if (!v) return { ok: false, reason: `no variable "${key}" in "${sheetTitle}"` };
    return { ok: true, value: v };
  }

  private exportsFor(sheet: SheetSource): SheetExports {
    const cached = this.cache.get(sheet.id);
    if (cached) return cached;
    this.resolving.push(sheet.id);
    let results: LineResult[];
    try {
      results = this.engine.evaluateDocument(sheet.text, (s, k) => this.resolveXRef(s, k));
    } finally {
      this.resolving.pop();
    }
    const vars = new Map<string, Value>();
    for (const r of results) {
      if (r.assign && r.value) vars.set(r.assign, r.value);
    }
    let last: Value | null = null;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].kind === "normal" && results[i].value) {
        last = results[i].value;
        break;
      }
    }
    const exports: SheetExports = { vars, total: this.engine.totalValueOf(results), last };
    // A cycle-interrupted pass produces incomplete/wrong exports (dropped
    // assignments, missing total) — don't let it poison the cache. Re-evaluate
    // fresh on every query until the cycle is actually broken by an edit.
    if (!results.some((r) => r.error === "circular reference")) {
      this.cache.set(sheet.id, exports);
    }
    return exports;
  }
}
