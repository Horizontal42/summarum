// JS extensions runtime: numi.setVariable, numi.addUnit, numi.addFunction.
// Scripts run inside a QuickJS WASM sandbox — no DOM, no Tauri IPC, no host globals.
import {
  newQuickJSWASMModuleFromVariant,
  QuickJSContext,
  QuickJSHandle,
} from "quickjs-emscripten-core";
import releaseSyncVariant from "@jitl/quickjs-singlefile-browser-release-sync";
import { SumEngine, ExtensionUnitSpec, ExtensionValue } from "./engine";
import { logger } from "./logger";

interface ExtensionApi {
  setVariable(name: string, value: number | ExtensionValue): void;
  addUnit(spec: ExtensionUnitSpec): void;
  addFunction(
    spec: { id: string; phrases: string },
    fn: (values: ExtensionValue[]) => ExtensionValue | number,
  ): void;
}

export function makeApi(engine: SumEngine): ExtensionApi {
  return {
    setVariable: (name, value) => engine.setVariable(name, value),
    addUnit: (spec) => engine.addUnit(spec),
    addFunction: (spec, fn) => engine.addFunction(spec, fn),
  };
}

// 32 MB is orders of magnitude more than a sheet helper needs, and small enough
// that a runaway allocation fails inside the sandbox instead of the host heap.
const MEMORY_LIMIT = 32 * 1024 * 1024;
// 512 KB — unbounded recursion hits this and throws in the sandbox, never on the JS stack.
const STACK_SIZE = 512 * 1024;
// One-off cost at startup, so it can be generous.
const LOAD_TIMEOUT_MS = 1000;
// Registered functions are called synchronously from evaluateDocument, i.e. on
// every keystroke for every line that uses them — this budget must stay small.
const CALL_TIMEOUT_MS = 50;

const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

function toExtValue(v: unknown, what: string): ExtensionValue | number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") {
    const o = v as { double?: unknown; unitId?: unknown };
    if (typeof o.double === "number" && Number.isFinite(o.double)) {
      return typeof o.unitId === "string"
        ? { double: o.double, unitId: o.unitId }
        : { double: o.double };
    }
  }
  throw new Error(`${what}: expected a number or { double, unitId? }`);
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (
    e &&
    typeof e === "object" &&
    typeof (e as { message?: unknown }).message === "string"
  ) {
    return (e as { message: string }).message;
  }
  return String(e);
}

// The sandbox has no console/setTimeout/fetch: an extension touching those gets a
// ReferenceError inside QuickJS, which surfaces as a normal per-script failure.
// Never rejects — boot() runs unawaited, so a broken sandbox must not stop the app.
export async function runExtensions(
  engine: SumEngine,
  scripts: { name: string; code: string }[],
): Promise<void> {
  if (scripts.length === 0) return;
  try {
    await load(engine, scripts);
  } catch (e) {
    logger.warn("extensions disabled: QuickJS sandbox unavailable:", e);
  }
}

type RunWithTimeout = <T>(timeoutMs: number, fn: () => T) => T;

function callGuest(
  vm: QuickJSContext,
  id: string,
  fn: QuickJSHandle,
  values: ExtensionValue[],
  runWithTimeout: RunWithTimeout,
): ExtensionValue | number {
  // extension-sample.js convention: the callback takes one array of values.
  const arr = vm.newArray();
  try {
    values.forEach((v, i) => {
      const o = vm.newObject();
      const d = vm.newNumber(v.double);
      vm.setProp(o, "double", d);
      d.dispose();
      if (v.unitId) {
        const u = vm.newString(v.unitId);
        vm.setProp(o, "unitId", u);
        u.dispose();
      }
      vm.setProp(arr, i, o);
      o.dispose();
    });
    const res = runWithTimeout(CALL_TIMEOUT_MS, () =>
      vm.callFunction(fn, vm.undefined, [arr]),
    );
    if (res.error) {
      const err = vm.dump(res.error);
      res.error.dispose();
      throw new Error(`${id}: ${message(err)}`);
    }
    const out = vm.dump(res.value);
    res.value.dispose();
    return toExtValue(out, id);
  } finally {
    arr.dispose();
  }
}

function exposeApi(
  vm: QuickJSContext,
  api: ExtensionApi,
  runWithTimeout: RunWithTimeout,
) {
  const numi = vm.newObject();
  const define = (name: string, impl: (...args: QuickJSHandle[]) => void) => {
    const fn = vm.newFunction(name, (...args) => {
      try {
        impl(...args);
      } catch (e) {
        return { error: vm.newError(`numi.${name}: ${message(e)}`) };
      }
    });
    vm.setProp(numi, name, fn);
    fn.dispose();
  };

  define("setVariable", (nameHandle, valueHandle) => {
    const name = vm.dump(nameHandle);
    if (typeof name !== "string" || !name)
      throw new Error("expects a variable name");
    api.setVariable(name, toExtValue(vm.dump(valueHandle), "value"));
  });

  define("addUnit", (specHandle) => {
    const spec = vm.dump(specHandle);
    if (
      !spec ||
      typeof spec.id !== "string" ||
      typeof spec.baseUnitId !== "string" ||
      typeof spec.ratio !== "number"
    ) {
      throw new Error("expects { id, phrases, baseUnitId, ratio }");
    }
    api.addUnit({
      id: spec.id,
      phrases: typeof spec.phrases === "string" ? spec.phrases : spec.id,
      baseUnitId: spec.baseUnitId,
      ...(typeof spec.format === "string" ? { format: spec.format } : {}),
      ratio: spec.ratio,
    });
  });

  define("addFunction", (specHandle, fnHandle) => {
    const spec = vm.dump(specHandle);
    if (!spec || typeof spec.id !== "string")
      throw new Error("expects { id, phrases }");
    if (!fnHandle || vm.typeof(fnHandle) !== "function")
      throw new Error("expects a function");
    // outlives this callback, so it needs its own reference; the context is never disposed
    const guestFn = fnHandle.dup();
    const id = spec.id;
    api.addFunction(
      { id, phrases: typeof spec.phrases === "string" ? spec.phrases : id },
      (values) => callGuest(vm, id, guestFn, values, runWithTimeout),
    );
  });

  vm.setProp(vm.global, "numi", numi);
  numi.dispose();
}

function evaluateScripts(
  vm: QuickJSContext,
  scripts: { name: string; code: string }[],
  runWithTimeout: RunWithTimeout,
) {
  for (const s of scripts) {
    try {
      const res = runWithTimeout(LOAD_TIMEOUT_MS, () =>
        vm.evalCode(s.code, s.name),
      );
      if (res.error) {
        const err = vm.dump(res.error);
        res.error.dispose();
        throw new Error(message(err));
      }
      res.value.dispose();
    } catch (e) {
      logger.error(`extension ${s.name} failed:`, e);
    }
  }
}

async function load(
  engine: SumEngine,
  scripts: { name: string; code: string }[],
): Promise<void> {
  const mod = await newQuickJSWASMModuleFromVariant(releaseSyncVariant);
  const vm: QuickJSContext = mod.newContext();
  vm.runtime.setMemoryLimit(MEMORY_LIMIT);
  vm.runtime.setMaxStackSize(STACK_SIZE);

  // Armed before every entry into the sandbox and disarmed after, so a hung script
  // at load time and a hung function call on keystroke N are both bounded.
  let deadline = Infinity;
  vm.runtime.setInterruptHandler(() => now() > deadline);

  const runWithTimeout: RunWithTimeout = (timeoutMs, fn) => {
    deadline = now() + timeoutMs;
    try {
      return fn();
    } finally {
      deadline = Infinity;
    }
  };

  exposeApi(vm, makeApi(engine), runWithTimeout);
  evaluateScripts(vm, scripts, runWithTimeout);
}
