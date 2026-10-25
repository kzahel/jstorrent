import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), apply: vi.fn().mockResolvedValue(undefined), bind: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mock.listen }));
vi.mock("./localization/runtime", () => ({ applyDesktopLocaleSnapshot: mock.apply, bindDesktopLanguageAuthority: mock.bind }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

it("subscribes before loading native selection, shares one owner, and forwards changes", async () => {
  const snapshot = { preference: "system", locale: "en", availableLocales: ["en"] };
  const changed = { ...snapshot, preference: "en" };
  mock.invoke.mockResolvedValue(snapshot);
  mock.listen.mockResolvedValue(vi.fn());
  const { initializeTauriLocalization } = await import("./tauri-localization");
  await Promise.all([initializeTauriLocalization(), initializeTauriLocalization()]);
  expect(mock.listen).toHaveBeenCalledTimes(1);
  expect(mock.listen.mock.calls[0]![0]).toBe("desktop://locale-changed");
  expect(mock.invoke).toHaveBeenCalledWith("load_desktop_locale");
  expect(mock.bind.mock.calls[0]![1]).toEqual(snapshot);
  await mock.bind.mock.calls[0]![0].save("en");
  expect(mock.invoke).toHaveBeenCalledWith("set_desktop_locale", { preference: "en" });
  mock.listen.mock.calls[0]![1]({ payload: changed });
  expect(mock.apply).toHaveBeenCalledWith(changed);
});

it("keeps a newer native event received while the initial load is pending", async () => {
  const initial = { preference: "system", locale: "en", availableLocales: ["en"] };
  const changed = { ...initial, preference: "en" };
  mock.listen.mockImplementation(async (_name, handler) => { handler({ payload: changed }); return vi.fn(); });
  mock.invoke.mockResolvedValue(initial);
  const { initializeTauriLocalization } = await import("./tauri-localization");
  await initializeTauriLocalization();
  expect(mock.bind.mock.calls[0]![1]).toEqual(changed);
});

it("does not let an older command result replace a newer native locale event", async () => {
  const initial = { preference: "system", locale: "en", availableLocales: ["en", "de"] };
  const result = { ...initial, preference: "en" };
  const changed = { ...initial, locale: "de" };
  let finish: ((snapshot: typeof initial) => void) | undefined;
  mock.listen.mockResolvedValue(vi.fn());
  mock.invoke.mockImplementation((command) => command === "load_desktop_locale"
    ? Promise.resolve(initial) : new Promise<typeof initial>((resolve) => { finish = resolve; }));
  const { initializeTauriLocalization } = await import("./tauri-localization");
  await initializeTauriLocalization();
  const pending = mock.bind.mock.calls[0]![0].save("en");
  mock.listen.mock.calls[0]![1]({ payload: changed });
  finish!(result);
  expect(await pending).toEqual(changed);
});
