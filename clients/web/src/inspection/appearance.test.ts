import { describe, expect, it, vi } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_COLOR_THEME,
  DEFAULT_DATA_UNITS,
  DEFAULT_INTERFACE_SIZE,
  applyAppearancePreferences,
  applyColorTheme,
  applyInterfaceSize,
  applyStoredAppearance,
  loadAppearancePreferences,
  saveAppearancePreferences,
} from "./appearance";

describe("appearance preferences", () => {
  it("defaults to Standard, Auto, and Binary without a stored preference", () => {
    expect(loadAppearancePreferences(null)).toEqual({
      interfaceSize: DEFAULT_INTERFACE_SIZE,
      colorTheme: DEFAULT_COLOR_THEME,
      dataUnits: DEFAULT_DATA_UNITS,
    });
    expect(loadAppearancePreferences({ getItem: () => null })).toEqual({
      interfaceSize: "standard",
      colorTheme: "auto",
      dataUnits: "binary",
    });
  });

  it("resets prior appearance versions to current defaults", () => {
    for (const value of [
      { version: 1, interfaceSize: "compact" },
      { version: 2, interfaceSize: "spacious", colorTheme: "dark" },
    ]) {
      expect(loadAppearancePreferences(stored(JSON.stringify(value)))).toEqual({
        interfaceSize: "standard",
        colorTheme: "auto",
        dataUnits: "binary",
      });
    }
  });

  it("round trips every accepted appearance combination", () => {
    for (const interfaceSize of ["compact", "standard", "spacious"] as const) {
      for (const colorTheme of ["auto", "light", "dark"] as const) {
        for (const dataUnits of ["binary", "decimal"] as const) {
          let source: string | null = null;
          const storage = {
            getItem: (key: string) =>
              key === APPEARANCE_STORAGE_KEY ? source : null,
            setItem: (key: string, value: string) => {
              if (key === APPEARANCE_STORAGE_KEY) source = value;
            },
          };
          saveAppearancePreferences(
            { interfaceSize, colorTheme, dataUnits },
            storage,
          );
          expect(loadAppearancePreferences(storage)).toEqual({
            interfaceSize,
            colorTheme,
            dataUnits,
          });
          expect(JSON.parse(source ?? "null")).toEqual({
            version: 3,
            interfaceSize,
            colorTheme,
            dataUnits,
          });
        }
      }
    }
  });

  it("validates version-3 fields independently", () => {
    expect(
      loadAppearancePreferences(
        stored(
          JSON.stringify({
            version: 3,
            interfaceSize: "huge",
            colorTheme: "dark",
            dataUnits: "decimal",
          }),
        ),
      ),
    ).toEqual({
      interfaceSize: "standard",
      colorTheme: "dark",
      dataUnits: "decimal",
    });
    expect(
      loadAppearancePreferences(
        stored(
          JSON.stringify({
            version: 3,
            interfaceSize: "compact",
            colorTheme: "sepia",
            dataUnits: "decimal",
          }),
        ),
      ),
    ).toEqual({
      interfaceSize: "compact",
      colorTheme: "auto",
      dataUnits: "decimal",
    });
    expect(
      loadAppearancePreferences(
        stored(
          JSON.stringify({
            version: 3,
            interfaceSize: "spacious",
            colorTheme: "light",
            dataUnits: "blocks",
          }),
        ),
      ),
    ).toEqual({
      interfaceSize: "spacious",
      colorTheme: "light",
      dataUnits: "binary",
    });
  });

  it("rejects malformed and future stored values", () => {
    expect(loadAppearancePreferences(stored("not json"))).toEqual({
      interfaceSize: "standard",
      colorTheme: "auto",
      dataUnits: "binary",
    });
    expect(
      loadAppearancePreferences(
        stored(
          JSON.stringify({
            version: 4,
            interfaceSize: "compact",
            colorTheme: "dark",
          }),
        ),
      ),
    ).toEqual({
      interfaceSize: "standard",
      colorTheme: "auto",
      dataUnits: "binary",
    });
  });

  it("applies validated appearance preferences to a document root", () => {
    const root = { dataset: {} } as Pick<HTMLElement, "dataset">;
    applyColorTheme("light", root);
    applyInterfaceSize("compact", root);
    expect(root.dataset.colorTheme).toBe("light");
    expect(root.dataset.interfaceSize).toBe("compact");

    applyAppearancePreferences(
      { interfaceSize: "standard", colorTheme: "auto" },
      root,
    );
    expect(root.dataset.colorTheme).toBe("auto");
    expect(root.dataset.interfaceSize).toBe("standard");

    const preferences = applyStoredAppearance(
      stored(
        JSON.stringify({
          version: 3,
          interfaceSize: "spacious",
          colorTheme: "dark",
          dataUnits: "decimal",
        }),
      ),
      root,
    );
    expect(preferences).toEqual({
      interfaceSize: "spacious",
      colorTheme: "dark",
      dataUnits: "decimal",
    });
    expect(root.dataset.colorTheme).toBe("dark");
    expect(root.dataset.interfaceSize).toBe("spacious");
  });

  it("tolerates denied browser storage", () => {
    const read = vi.fn(() => {
      throw new Error("denied");
    });
    const write = vi.fn(() => {
      throw new Error("denied");
    });
    expect(loadAppearancePreferences({ getItem: read })).toEqual({
      interfaceSize: "standard",
      colorTheme: "auto",
      dataUnits: "binary",
    });
    expect(() =>
      saveAppearancePreferences(
        { interfaceSize: "spacious", colorTheme: "dark", dataUnits: "decimal" },
        { setItem: write },
      ),
    ).not.toThrow();
  });
});

function stored(source: string) {
  return { getItem: () => source };
}
