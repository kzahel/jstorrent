// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef, useLayoutEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { clientSettingsRuntimeFixture } from "../../test-support/client-settings";
import { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog";
import { ToastProvider } from "./Toast";

// Hidden host-policy panels do not need a live application controller here.
vi.mock("../context", () => ({
  useInspectionCommand: () => vi.fn(),
  useInspectionStore: (selector: (state: object) => unknown) =>
    selector({ durableRevision: "1", session: { hostCapabilities: [] } }),
}));

afterEach(cleanup);

function props(): SettingsDialogProps {
  return {
    colorTheme: "auto", interfaceSize: "standard", dataUnits: "binary",
    storage: { roots: [], defaultRoot: null, showAddOptions: true, showFileSelection: true },
    clientSettings: clientSettingsRuntimeFixture(), downloadsManageable: false,
    showCrostiniStorageHelp: false, clientSettingsManageable: false,
    returnFocus: createRef<HTMLButtonElement>(),
    onColorThemeChange: vi.fn(), onInterfaceSizeChange: vi.fn(), onDataUnitsChange: vi.fn(),
    onChooseFolder: vi.fn(async () => null), onDefaultRootChange: vi.fn(async () => {}),
    onShowAddOptionsChange: vi.fn(async () => {}), onShowFileSelectionChange: vi.fn(async () => {}),
    onRemoveRoot: vi.fn(async () => {}), onClientSettingsSave: vi.fn(),
    onWebAuthSignedOut: vi.fn(), onClose: vi.fn(),
  };
}

it("settles initial dialog focus before a following interaction can choose a control", () => {
  const values = props();
  function ImmediateInteraction() {
    // Native webview automation (and another layout interaction) can run
    // before passive effects. Initial autofocus must not run afterward and
    // replace that newer choice with the Close button.
    useLayoutEffect(() => { screen.getByRole("radio", { name: "English" }).focus(); }, []);
    return <SettingsDialog {...values} />;
  }
  render(<ToastProvider><ImmediateInteraction /></ToastProvider>);
  expect(screen.getByRole("radio", { name: "English" })).toHaveFocus();
});
