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
  (window as any).__numi_api = numi;
  for (const s of scripts) {
    await new Promise<void>((resolve) => {
      try {
        const wrappedCode = `try { (function(numi) { ${s.code} })(window.__numi_api); } catch(e) { window.__numi_err = e; }`;
        const blob = new Blob([wrappedCode], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        const script = document.createElement("script");
        script.src = url;
        script.onload = () => {
          URL.revokeObjectURL(url);
          if ((window as any).__numi_err) {
            console.error(`extension ${s.name} failed:`, (window as any).__numi_err);
            delete (window as any).__numi_err;
          }
          resolve();
        };
        script.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        document.head.appendChild(script);
      } catch (e) {
        console.error(`extension ${s.name} failed:`, e);
        resolve();
      }
    });
  }
  delete (window as any).__numi_api;
}
