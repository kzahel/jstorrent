// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render as renderUnwrapped,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { TorrentListImportReport, TorrentListImportTarget } from "../../api";
import type { DownloadRoot } from "../model";
import { ToastProvider } from "./Toast";
import { TorrentListSettingsSection } from "./TorrentListSettingsSection";

const render = (ui: Parameters<typeof renderUnwrapped>[0]) =>
  renderUnwrapped(ui, { wrapper: ToastProvider });

afterEach(cleanup);

const ROOTS: readonly DownloadRoot[] = [
  { id: "root_a", label: "Downloads", path: "/Users/test/Downloads", availability: "available" },
  { id: "root_gone", label: "Old drive", path: "/Volumes/Old", availability: "unavailable" },
  { id: "root_b", label: "Movies", path: "/Users/test/Movies", availability: "available" },
];

type Import = (
  target: TorrentListImportTarget,
  chooseFile: () => Promise<ArrayBuffer | null>,
) => Promise<TorrentListImportReport | null>;

function zipFile(bytes: Uint8Array<ArrayBuffer>): File {
  const file = new File([bytes], "jstorrent-torrents.zip", { type: "application/zip" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  return file;
}

function bundleInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][accept=".zip,application/zip"]');
  if (input === null) throw new Error("bundle file input is missing");
  return input;
}

it("is hidden where the client supports neither export nor import", () => {
  render(
    <TorrentListSettingsSection roots={ROOTS} defaultRoot="root_a" onBusyChange={vi.fn()} />,
  );
  expect(screen.queryByRole("heading", { name: "Torrent list" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("imports a chosen bundle into the chosen folder and lists what was not added", async () => {
  const onBusyChange = vi.fn();
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
  const onImport = vi.fn<Import>(async (_target, chooseFile) => {
    const chosen = await chooseFile();
    expect(new Uint8Array(chosen!)).toEqual(bytes);
    return {
      added: 2,
      already_present: 1,
      failed: [
        { name: "Broken", reason: "torrent file is malformed" },
        { name: "Elsewhere", reason: "no download folder" },
      ],
    };
  });
  render(
    <TorrentListSettingsSection
      roots={ROOTS}
      defaultRoot="root_a"
      onImport={onImport}
      onBusyChange={onBusyChange}
    />,
  );
  expect(screen.queryByRole("button", { name: "Export torrent list" })).not.toBeInTheDocument();
  const saveTo = screen.getByRole("combobox", { name: "Save to" });
  expect(saveTo).toHaveValue("root_a");
  // Only folders that can be written appear.
  expect(within(saveTo).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Downloads",
    "Movies",
  ]);
  const keep = screen.getByRole("checkbox", {
    name: "Use a download folder with the same name when there is one",
  });
  expect(keep).toBeChecked();
  fireEvent.change(saveTo, { target: { value: "root_b" } });
  fireEvent.click(keep);

  const input = bundleInput();
  const openChooser = vi.spyOn(input, "click");
  fireEvent.click(screen.getByRole("button", { name: "Import torrent list…" }));
  expect(openChooser).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
  fireEvent.change(input, { target: { files: [zipFile(bytes)] } });

  const report = (await screen.findByText("Added 2. Already in your list: 1."))
    .closest<HTMLElement>('[role="status"]')!;
  expect(onImport).toHaveBeenCalledWith(
    { storage_root: "root_b", keep_matching_locations: false },
    expect.any(Function),
  );
  expect(report).toHaveTextContent("Couldn't add 2:");
  expect(within(report).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "Broken — torrent file is malformed",
    "Elsewhere — no download folder",
  ]);
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByRole("button", { name: "Import torrent list…" })).toBeEnabled();
});

it("does nothing when the file chooser is cancelled", async () => {
  const onBusyChange = vi.fn();
  const onImport = vi.fn<Import>(async (_target, chooseFile) =>
    (await chooseFile()) === null ? null : { added: 1, already_present: 0, failed: [] },
  );
  render(
    <TorrentListSettingsSection
      roots={ROOTS}
      defaultRoot="root_b"
      onImport={onImport}
      onBusyChange={onBusyChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Import torrent list…" }));
  fireEvent(bundleInput(), new Event("cancel"));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Import torrent list…" })).toBeEnabled(),
  );
  expect(onImport.mock.calls[0]![0]).toEqual({
    storage_root: "root_b",
    keep_matching_locations: true,
  });
  expect(screen.queryByText(/^Added/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(onBusyChange).not.toHaveBeenCalled();
});

it("reports export and import failures beside their buttons", async () => {
  const onExport = vi.fn(async () => {
    throw new Error("disk full");
  });
  const onImport = vi.fn<Import>(async () => {
    throw new Error("bundle has no manifest");
  });
  render(
    <TorrentListSettingsSection
      roots={ROOTS}
      defaultRoot="root_a"
      onExport={onExport}
      onImport={onImport}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Export torrent list" }));
  expect(await screen.findByText("Couldn't export the torrent list. disk full")).toHaveAttribute(
    "role",
    "alert",
  );
  fireEvent.click(screen.getByRole("button", { name: "Import torrent list…" }));
  expect(
    await screen.findByText("Couldn't import the torrent list. bundle has no manifest"),
  ).toHaveAttribute("role", "alert");
});

it("confirms a saved export and stays quiet when it is cancelled", async () => {
  const onExport = vi.fn<() => Promise<boolean>>()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  render(
    <TorrentListSettingsSection
      roots={ROOTS}
      defaultRoot="root_a"
      onExport={onExport}
      onBusyChange={vi.fn()}
    />,
  );
  const exportButton = screen.getByRole("button", { name: "Export torrent list" });
  fireEvent.click(exportButton);
  await waitFor(() => expect(exportButton).toBeEnabled());
  expect(screen.queryByRole("region", { name: "Notification" })).not.toBeInTheDocument();
  fireEvent.click(exportButton);
  const toast = await screen.findByRole("region", { name: "Notification" });
  expect(toast).toHaveTextContent("Torrent list saved.");
  expect(screen.queryByRole("combobox", { name: "Save to" })).not.toBeInTheDocument();
});

it("asks for a download folder before an import", () => {
  render(
    <TorrentListSettingsSection
      roots={[ROOTS[1]!]}
      defaultRoot={null}
      onImport={vi.fn<Import>()}
      onBusyChange={vi.fn()}
    />,
  );
  expect(screen.getByText("Add a download folder first.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Import torrent list…" })).toBeDisabled();
});
