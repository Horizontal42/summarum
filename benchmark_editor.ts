import { EditorState } from "@codemirror/state";

const lines = [];
for (let i = 0; i < 500000; i++) {
    lines.push(`some_var_${i} = ${i * 10} + 5`);
}
const text = lines.join('\n');
const state = EditorState.create({ doc: text });

function benchmarkOld() {
    const start = performance.now();
    const options = [];
    const docText = state.doc.toString();
    for (const m of docText.matchAll(/^\s*([\p{L}_][\p{L}\d_]*)\s*=/gmu)) {
        options.push({ label: m[1], type: "variable" });
    }
    const end = performance.now();
    return end - start;
}

const pattern = /^\s*([\p{L}_][\p{L}\d_]*)\s*=/u;
function benchmarkRegexPerLine() {
    const start = performance.now();
    const options = [];
    const iter = state.doc.iterLines();
    for (let next = iter.next(); !next.done; next = iter.next()) {
        const line = next.value;
        // Optimization: checking '=' first is significantly faster than firing regex blindly
        if (line.includes('=')) {
            const m = pattern.exec(line);
            if (m) {
                options.push({ label: m[1], type: "variable" });
            }
        }
    }
    const end = performance.now();
    return end - start;
}

benchmarkOld();
benchmarkRegexPerLine();

let oldTotal = 0;
let newTotal = 0;
for (let i = 0; i < 10; i++) {
    oldTotal += benchmarkOld();
    newTotal += benchmarkRegexPerLine();
}

console.log(`Old avg: ${oldTotal / 10} ms`);
console.log(`Regex per line with '=' check avg: ${newTotal / 10} ms`);
