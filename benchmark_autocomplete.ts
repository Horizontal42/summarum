import { SumEngine } from "./src/engine/index.js";
import { SumEditor } from "./src/ui/editor.js";

// Not easy to fully instantiate the EditorView in Node without mocked DOM.
// We can just create a standalone benchmark for the two methods of extracting variables.

import { Text } from "@codemirror/state";

const varPattern = /^\s*([\p{L}_][\p{L}\d_]*)\s*=/u;

function methodOld(doc: Text) {
  const options = [];
  const iter = doc.iterLines();
  for (let next = iter.next(); !next.done; next = iter.next()) {
    const line = next.value;
    if (line.includes("=")) {
      const m = varPattern.exec(line);
      if (m) {
        options.push({ label: m[1], type: "variable" });
      }
    }
  }
  return options;
}

function methodNew(results: any[]) {
  const options = [];
  for (let i = 0, len = results.length; i < len; i++) {
    const assign = results[i].assign;
    if (assign) {
      options.push({ label: assign, type: "variable" });
    }
  }
  return options;
}

const lines = [];
const results = [];
for (let i = 0; i < 100000; i++) {
  if (i % 10 === 0) {
    lines.push(`var_${i} = ${i}`);
    results.push({ assign: `var_${i}` });
  } else {
    lines.push(`just some text ${i} without equals`);
    results.push({});
  }
}
const docText = lines.join('\n');
const doc = Text.of(lines);

console.log("Warming up...");
for(let i=0; i<10; i++) {
  methodOld(doc);
  methodNew(results);
}

console.log("Benchmarking Old Method...");
const startOld = performance.now();
for(let i=0; i<100; i++) {
  methodOld(doc);
}
const endOld = performance.now();
console.log(`Old Method: ${(endOld - startOld).toFixed(2)} ms`);

console.log("Benchmarking New Method...");
const startNew = performance.now();
for(let i=0; i<100; i++) {
  methodNew(results);
}
const endNew = performance.now();
console.log(`New Method: ${(endNew - startNew).toFixed(2)} ms`);
