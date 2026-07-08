// JS extensions runtime: numi.setVariable,
// numi.addUnit, numi.addFunction. Scripts share the engine's JS runtime.
import { SumEngine, ExtensionUnitSpec, ExtensionValue } from "./engine";

interface ExtensionApi {
  setVariable(name: string, value: number | ExtensionValue): void;
  addUnit(spec: ExtensionUnitSpec): void;
  addFunction(spec: { id: string; phrases: string }, fn: (values: ExtensionValue[]) => ExtensionValue | number): void;
}

export function makeApi(engine: SumEngine): ExtensionApi {
  return {
    setVariable: (name, value) => engine.setVariable(name, value),
    addUnit: (spec) => engine.addUnit(spec),
    addFunction: (spec, fn) => engine.addFunction(spec, fn),
  };
}

export async function runExtensions(engine: SumEngine, scripts: { name: string; code: string }[]): Promise<void> {
  const numi = makeApi(engine);
  let id = 0;
  for (const s of scripts) {
    const globalName = `__numi_ext_${id++}`;
    (window as any)[globalName] = numi;

    const code = `
      try {
        (function(numi) {
          ${s.code}
        })(window.${globalName});
      } catch (e) {
        console.error(\`extension \${s.name} failed:\`, e);
      }
    `;

    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const script = document.createElement("script");
    script.src = url;

    await new Promise<void>((resolve) => {
      script.onload = () => {
        URL.revokeObjectURL(url);
        delete (window as any)[globalName];
        script.remove();
        resolve();
      };
      script.onerror = (e) => {
        console.error(`extension ${s.name} failed to load:`, e);
        URL.revokeObjectURL(url);
        delete (window as any)[globalName];
        script.remove();
        resolve();
      };
      document.head.appendChild(script);
    });
  }
}
