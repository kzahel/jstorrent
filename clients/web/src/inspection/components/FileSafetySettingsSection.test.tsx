// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_CLIENT_SETTINGS, type FileSafetySettings } from "../../api";
import { FileSafetySettingsSection } from "./FileSafetySettingsSection";

const host = vi.hoisted(() => ({
  capabilities: ["file_safety"],
  revision: "1",
  execute: vi.fn(),
}));
vi.mock("../context", () => ({
  useInspectionCommand: () => host.execute,
  useInspectionStore: (selector: (state: object) => unknown) =>
    selector({
      session: { hostCapabilities: host.capabilities },
      durableRevision: host.revision,
    }),
}));
beforeEach(() => {
  host.capabilities = ["file_safety"];
  host.revision = "1";
  host.execute
    .mockReset()
    .mockResolvedValue({ accepted: true, resultingRevision: "2" });
});
afterEach(cleanup);

it("seeds Custom from the preset and saves the independent default-on origin setting", async () => {
  const user = userEvent.setup();
  const settings = structuredClone(DEFAULT_CLIENT_SETTINGS.file_safety);
  const view = render(
    <FileSafetySettingsSection settings={settings} manageable />,
  );
  expect(
    screen.getByRole("checkbox", {
      name: "Mark downloaded files as coming from the internet",
    }),
  ).toBeChecked();
  await user.selectOptions(screen.getByRole("combobox"), "custom");
  const extensions = screen.getByRole("textbox");
  expect((extensions as HTMLTextAreaElement).value).toContain(".exe");
  await user.clear(extensions);
  await user.type(extensions, ".EXE, .tar.gz");
  await user.click(
    screen.getByRole("checkbox", {
      name: "Mark downloaded files as coming from the internet",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "Save file safety settings" }),
  );
  const saved: FileSafetySettings = {
    enabled: true,
    preset: "custom",
    custom_extensions: [".exe", ".tar.gz"],
    mark_internet_origin: false,
  };
  await waitFor(() =>
    expect(host.execute).toHaveBeenCalledWith({
      type: "update_file_safety_settings",
      settings: saved,
    }),
  );
  expect(
    screen.getByRole("button", { name: "Save file safety settings" }),
  ).toBeDisabled();
  host.revision = "2";
  view.rerender(<FileSafetySettingsSection settings={saved} manageable />);
  await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
  expect(
    screen.getByRole("button", { name: "Save file safety settings" }),
  ).toBeDisabled();
});

it("preserves a conflicting draft until the user discards it", async () => {
  const user = userEvent.setup();
  const settings = structuredClone(DEFAULT_CLIENT_SETTINGS.file_safety);
  const view = render(
    <FileSafetySettingsSection settings={settings} manageable />,
  );
  await user.selectOptions(screen.getByRole("combobox"), "custom");
  host.revision = "2";
  view.rerender(
    <FileSafetySettingsSection
      settings={{ ...settings, preset: "archives" }}
      manageable
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "changed in another client",
    ),
  );
  expect(screen.getByRole("combobox")).toHaveValue("custom");
  expect(
    screen.getByRole("button", { name: "Save file safety settings" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByRole("combobox")).toHaveValue("archives");
  expect(host.execute).not.toHaveBeenCalled();
});

it("hides the feature for an older host and rejects invalid extension drafts", async () => {
  host.capabilities = [];
  const view = render(
    <FileSafetySettingsSection
      settings={DEFAULT_CLIENT_SETTINGS.file_safety}
      manageable
    />,
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  host.capabilities = ["file_safety"];
  view.rerender(
    <FileSafetySettingsSection
      settings={DEFAULT_CLIENT_SETTINGS.file_safety}
      manageable
    />,
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox"), "custom");
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), "*.exe");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Use at most 128 extensions",
  );
  expect(
    screen.getByRole("button", { name: "Save file safety settings" }),
  ).toBeDisabled();
  expect(host.execute).not.toHaveBeenCalled();
});
