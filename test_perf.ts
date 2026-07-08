import { SumEngine } from "./src/engine";
import { Workspace, SheetSource } from "./src/workspace";
import { performance } from "perf_hooks";

function makeWorkspace(initial: Record<string, { title: string; text: string }>) {
  const engine = new SumEngine();
  const store = new Map(Object.entries(initial).map(([id, v]) => [id, { id, ...v }]));
  const sheets = (): SheetSource[] => [...store.values()];
  const ws = new Workspace(engine, sheets);
  return { engine, store, ws };
}

// Generates a wide cross-sheet resolution case where resolving stack goes deep,
// then the bottom sheet needs to verify many different target nodes are NOT
// in the resolving stack. Since `includes` is O(N) where N is the stack depth,
// doing this `M` times leads to an O(N * M) operation per full cycle,
// which `Set` reduces to O(M).
const numLeaves = 4000;
const sheetsObj: Record<string, {title: string, text: string}> = {};

let finalText = "";
for (let i = 0; i < numLeaves; i++) {
   sheetsObj[`leaf${i}`] = { title: `Leaf${i}`, text: `a = ${i}` };
   finalText += `x${i} = @Leaf${i}.a\n`;
}
// Final references all Leaf_i
sheetsObj[`final`] = { title: `Final`, text: finalText };

const depth = 500;
for(let i=0; i<depth; i++) {
  // S_i refs S_{i+1}
  sheetsObj[`s${i}`] = { title: `S${i}`, text: i < depth - 1 ? `a = @S${i+1}.a` : `a = @Final.x0` };
}

const { ws } = makeWorkspace(sheetsObj);

function runTest() {
  ws.invalidateAll();
  const t0 = performance.now();
  // evaluate s0
  const result = ws.evaluateSheet(`s0`, `b = @S0.a`);
  const t1 = performance.now();
  return t1 - t0;
}

runTest(); // Warmup

let total = 0;
const runs = 10;
for(let i=0; i<runs; i++) {
  total += runTest();
}
console.log(`Average time: ${total / runs}ms`);
