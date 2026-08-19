import { searchAllSheets } from "../src/ui/search.js";
import { SumEngine } from "../src/engine/index.js";
import { Workspace } from "../src/workspace.js";
import Decimal from "decimal.js";
import { performance } from "perf_hooks";

function generateDummyDoc(id: string, title: string, numLines: number): any {
  const lines = [];
  for (let i = 0; i < numLines; i++) {
    lines.push(`Line ${i}: this is some dummy text to search. The quick brown fox jumps over the lazy dog.`);
  }
  lines.push(`Line target: looking for SPECIFIC_WORD here.`);
  for (let i = 0; i < numLines; i++) {
    lines.push(`Line ${i + numLines + 1}: more random text. A journey of a thousand miles begins with a single step.`);
  }
  return { id, title, text: lines.join("\n") };
}

const docs = [];
for (let i = 0; i < 500; i++) { // Increase size to 1M lines
  docs.push(generateDummyDoc(`doc_${i}`, `Document ${i}`, 1000)); // ~2000 lines per doc, 500 docs = 1,000,000 lines
}

const engine = new SumEngine();
const workspace = new Workspace(engine);

const deps = {
  engine,
  workspace,
  docs: () => docs,
  t: (key: string) => key,
  onOpen: () => {}
};

console.log(`Starting benchmark with ${docs.length} documents...`);

const start1 = performance.now();
const res1 = searchAllSheets(deps, "specific_word");
const end1 = performance.now();
console.log(`Baseline Search (specific_word): ${(end1 - start1).toFixed(2)}ms, Hits: ${res1.length}`);

const start2 = performance.now();
const res2 = searchAllSheets(deps, "not_found_word_that_is_very_long");
const end2 = performance.now();
console.log(`Baseline Search (not_found_word): ${(end2 - start2).toFixed(2)}ms, Hits: ${res2.length}`);
