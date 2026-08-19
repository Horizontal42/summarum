import { test, vi, expect } from "vitest";

vi.mock("./ui/editor", () => ({
    SumEditor: vi.fn().mockImplementation(() => ({
        goToLine: vi.fn(),
        getSheetWithResults: vi.fn(() => "test-results"),
        getText: vi.fn(() => "test"),
        focus: vi.fn(),
        refresh: vi.fn(),
    }))
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("@tauri-apps/api/window", () => ({
    getCurrentWindow: vi.fn(() => ({
        minimize: vi.fn(),
        hide: vi.fn(),
        show: vi.fn(),
    })),
}));

vi.mock("./storage", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as object,
        isTauri: vi.fn(() => false),
        loadSettings: vi.fn(() => ({ language: "en", autostart: false, alwaysOnTop: false, autoUpdateEnabled: false, sidebarVisible: false, hotkey: "CmdOrCtrl+Space" })),
        loadAppData: vi.fn(() => ({ docs: [{id: "1", title: "Test"}], contents: {}, activeId: "1" })),
        saveSettings: vi.fn(),
        saveAppData: vi.fn(),
        getLaunchFile: vi.fn(() => null),
        flushAppData: vi.fn(),
        onAppQuit: vi.fn((_cb: any) => {}),
        onOpenFile: vi.fn(),
        onFileDrop: vi.fn(),
        registerHotkey: vi.fn(() => Promise.resolve(true)),
        applyAutostart: vi.fn(),
        applyAlwaysOnTop: vi.fn(),
        fetchRates: vi.fn(),
        fetchMarketData: vi.fn(),
        loadExtensionScripts: vi.fn(() => Promise.resolve([])),
    };
});

vi.mock("./ui/search", () => ({
    initSearch: vi.fn(() => ({ open: vi.fn() }))
}));

vi.mock("./updater", () => ({
    checkForUpdate: vi.fn(() => Promise.resolve(null))
}));

vi.mock("./extensions", () => ({
    runExtensions: vi.fn(() => Promise.resolve())
}));

test("boot application", async () => {
    const createMockElement = () => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn() },
        style: { setProperty: vi.fn() },
        dataset: {},
        value: "",
        appendChild: vi.fn(),
        setAttribute: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ right: 100, width: 100 })),
        closest: vi.fn(),
        blur: vi.fn(),
        replaceChildren: vi.fn(),
    });

    const mock$ = vi.fn(createMockElement);

    vi.stubGlobal("document", {
        querySelector: mock$,
        querySelectorAll: vi.fn(() => []), // For i18n
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        body: createMockElement(),
        documentElement: createMockElement(),
        createElement: vi.fn(createMockElement),
        createElementNS: vi.fn(createMockElement),
        createDocumentFragment: vi.fn(createMockElement),
        head: createMockElement(),
    });

    vi.stubGlobal("window", {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        performance: { now: () => 0 },
        print: vi.fn(),
        getSelection: vi.fn(() => null),
        setInterval: vi.fn(),
        setTimeout: vi.fn().mockImplementation((cb: Function) => cb()),
        dispatchEvent: vi.fn(),
        CustomEvent: vi.fn(),
    });

    vi.stubGlobal("matchMedia", vi.fn(() => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        matches: false,
    })));

    vi.stubGlobal("navigator", {
        clipboard: { writeText: vi.fn() },
        language: "en",
    });

    vi.stubGlobal("localStorage", {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
    });

    // Import main and wait for boot to complete
    await import("./main");
    await new Promise(r => setTimeout(r, 0));

    // As mock is hoisted, we can import actual mocked funcs
    const { loadSettings, loadAppData } = await import("./storage");
    expect(loadSettings).toHaveBeenCalled();
    expect(loadAppData).toHaveBeenCalled();
});
