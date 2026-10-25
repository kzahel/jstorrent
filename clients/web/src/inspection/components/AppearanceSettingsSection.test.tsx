// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bindDesktopLanguageAuthority } from "../../localization/runtime";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("explicit English selection replaces an unavailable preserved native override without browser writes", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  const storage = { setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  const save = vi.fn().mockResolvedValue({ preference: "en", locale: "en", availableLocales: ["en"] });
  try {
    await bindDesktopLanguageAuthority({ save }, { preference: "de", locale: "en", availableLocales: ["en"] });
    render(<AppearanceSettingsSection colorTheme="auto" interfaceSize="standard" dataUnits="binary" onColorThemeChange={vi.fn()} onInterfaceSizeChange={vi.fn()} onDataUnitsChange={vi.fn()} />);
    const english = screen.getByRole("radio", { name: "English" });
    expect(english).toBeChecked();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(english);
    await waitFor(() => expect(save).toHaveBeenCalledWith("en"));
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
});
