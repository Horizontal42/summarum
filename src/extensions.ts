// JS extensions runtime (Numi-compatible API): numi.setVariable,
// numi.addUnit, numi.addFunction. Scripts share the engine's JS runtime.
import { SumEngine, ExtensionUnitSpec, ExtensionValue } from "./engine";

export interface ExtensionApi {
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

export function runExtensions(engine: SumEngine, scripts: { name: string; code: string }[]): void {
  const numi = makeApi(engine);
  for (const s of scripts) {
    try {
      const fn = new Function("numi", s.code);
      fn(numi);
    } catch (e) {
      console.error(`extension ${s.name} failed:`, e);
    }
  }
}
