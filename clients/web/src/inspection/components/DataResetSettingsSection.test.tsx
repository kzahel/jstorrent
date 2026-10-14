// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as renderUnwrapped, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { DataResetSettingsSection } from "./DataResetSettingsSection";
import { ToastProvider } from "./Toast";

const render = (ui: Parameters<typeof renderUnwrapped>[0]) =>
  renderUnwrapped(ui, { wrapper: ToastProvider });

afterEach(cleanup);

it("keeps file deletion off by default and requires a second clear action", async () => {
  const clear = vi.fn(async (_deleteData: boolean) => {});
  render(
    <DataResetSettingsSection
      manageable
      deleteDataSupported
      onRestoreDefaults={vi.fn(async () => {})}
      onClearAppData={clear}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear app data…" }));
  expect(clear).not.toHaveBeenCalled();
  const deletion = screen.getByRole("checkbox", { name: /Also delete downloaded files/ });
  expect(deletion).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: /^Clear app data$/ }));
  await waitFor(() => expect(clear).toHaveBeenCalledWith(false));
  fireEvent.click(screen.getByRole("button", { name: "Clear app data…" }));
  const secondDeletion = screen.getByRole("checkbox", { name: /Also delete downloaded files/ });
  expect(secondDeletion).not.toBeChecked();
  fireEvent.click(secondDeletion);
  fireEvent.click(screen.getByRole("button", { name: /^Clear app data$/ }));
  await waitFor(() => expect(clear).toHaveBeenLastCalledWith(true));
});

it("keeps a failed reset open for retry and reports no success", async () => {
  const restore = vi.fn(async () => { throw new Error("Storage is busy"); });
  render(
    <DataResetSettingsSection
      manageable
      deleteDataSupported
      onRestoreDefaults={restore}
      onClearAppData={vi.fn(async () => {})}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Restore defaults…" }));
  fireEvent.click(screen.getByRole("button", { name: /^Restore defaults$/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage is busy");
  expect(screen.getByRole("button", { name: /^Restore defaults$/ })).toBeEnabled();
  expect(screen.queryByText("Default preferences restored.")).not.toBeInTheDocument();
});
