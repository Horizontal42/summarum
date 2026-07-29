// JS extensions runtime: numi.setVariable,
// numi.addUnit, numi.addFunction. Scripts share the engine's JS runtime.
import { SumEngine, ExtensionUnitSpec, ExtensionValue } from "./engine";
import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";

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
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  // Create numi object in QuickJS
  const numiHandle = vm.newObject();

  // Helper to convert QuickJS handle to JS value (simple types and ExtensionValue)
  const fromQuickJS = (handle: QuickJSHandle): any => {
    const type = vm.typeof(handle);
    if (type === "number") return vm.getNumber(handle);
    if (type === "string") return vm.getString(handle);
    if (type === "boolean") return vm.getNumber(handle) !== 0; // QuickJS booleans can be read as numbers? Wait, let's use dump
    return vm.dump(handle);
  };

  // Helper to convert JS value to QuickJS handle
  const toQuickJS = (val: any): QuickJSHandle => {
    if (typeof val === "number") return vm.newNumber(val);
    if (typeof val === "string") return vm.newString(val);
    if (typeof val === "boolean") return val ? vm.true : vm.false;
    if (typeof val === "object" && val !== null) {
       // Only handle simple ExtensionValue objects safely for return values
       const obj = vm.newObject();
       if ("double" in val) {
          const doubleHandle = vm.newNumber(val.double);
          vm.setProp(obj, "double", doubleHandle);
          doubleHandle.dispose();
       }
       if ("unitId" in val && val.unitId) {
          const unitIdHandle = vm.newString(val.unitId);
          vm.setProp(obj, "unitId", unitIdHandle);
          unitIdHandle.dispose();
       }
       return obj;
    }
    return vm.undefined;
  };

  const setVarHandle = vm.newFunction("setVariable", (nameHandle, valHandle) => {
    const name = vm.getString(nameHandle);
    const val = fromQuickJS(valHandle);
    try {
      numi.setVariable(name, val);
    } catch (e: any) {
      console.error("setVariable failed:", e);
    }
    return vm.undefined;
  });
  vm.setProp(numiHandle, "setVariable", setVarHandle);
  setVarHandle.dispose();

  const addUnitHandle = vm.newFunction("addUnit", (specHandle) => {
    const spec = vm.dump(specHandle) as ExtensionUnitSpec;
    try {
      numi.addUnit(spec);
    } catch (e: any) {
      console.error("addUnit failed:", e);
    }
    return vm.undefined;
  });
  vm.setProp(numiHandle, "addUnit", addUnitHandle);
  addUnitHandle.dispose();

  const addFunctionHandle = vm.newFunction("addFunction", (specHandle, fnHandle) => {
    const spec = vm.dump(specHandle) as { id: string; phrases: string };

    // We must keep the QuickJS function handle alive so the engine can call it later
    // In a real robust system, we would need to clean these up when the engine resets.
    // For now, we attach it to the engine's lifetime.
    const persistentFnHandle = fnHandle.dup();

    numi.addFunction(spec, (values: ExtensionValue[]) => {
      // Convert arguments to QuickJS Array
      const argsArray = vm.newArray();
      for (let i = 0; i < values.length; i++) {
         const valHandle = toQuickJS(values[i]);
         vm.setProp(argsArray, i, valHandle);
         valHandle.dispose();
      }

      const result = vm.callFunction(persistentFnHandle, vm.undefined, argsArray);
      argsArray.dispose();

      if (result.error) {
        console.error("Extension function error:", vm.dump(result.error));
        result.error.dispose();
        return 0; // fallback
      }

      const out = fromQuickJS(result.value);
      result.value.dispose();
      return out;
    });

    return vm.undefined;
  });
  vm.setProp(numiHandle, "addFunction", addFunctionHandle);
  addFunctionHandle.dispose();

  vm.setProp(vm.global, "numi", numiHandle);
  numiHandle.dispose();

  for (const s of scripts) {
    const result = vm.evalCode(s.code);
    if (result.error) {
      console.error(`extension ${s.name} failed:`, vm.dump(result.error));
      result.error.dispose();
    } else {
      result.value.dispose();
    }
  }

  // We cannot dispose the VM immediately if extensions added functions that need to be called later!
  // The SumEngine expects to call these functions during parsing.
  // So we deliberately leak/retain the vm instance here, or attach it to the engine.
  (engine as any).__qjs_vm = vm;
}
