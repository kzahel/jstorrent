// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileRow, FileSet, TorrentRow } from "../model";
import { PendingFileSelectionDialog } from "./PendingFileSelectionDialog";

afterEach(cleanup);

describe("pending file selection", () => {
  it("uses normal-or-skip checkboxes and sends compact ranges", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);
    renderDialog({ onConfirm });

    await user.click(screen.getByRole("checkbox", { name: /first\.mkv/i }));
    await user.click(screen.getByRole("checkbox", { name: /second\.srt/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /Don’t show file selection again/i }),
    );
    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm).toHaveBeenCalledWith(
      "current",
      [{ start: 0, endExclusive: 2, selected: false }],
      true,
    );
  });

  it("supports select-none plus sparse exceptions", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);
    renderDialog({ onConfirm });

    await user.click(screen.getByRole("button", { name: "None" }));
    await user.click(screen.getByRole("checkbox", { name: /second\.srt/i }));
    expect(screen.getByText(/1 of 2 selected/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm).toHaveBeenCalledWith(
      "none",
      [{ start: 1, endExclusive: 2, selected: true }],
      false,
    );
  });

  it("starts a fresh draft for the next queued torrent after confirming", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);
    const view = renderDialog({ onConfirm, queuedCount: 1 });

    await user.click(screen.getByRole("checkbox", { name: /first\.mkv/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /Don’t show file selection again/i }),
    );
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();

    view.rerender(
      dialogElement({
        onConfirm,
        torrent: { ...torrent(), id: "t1-11111111111111111111111111111111", name: "Next" },
      }),
    );

    expect(screen.getByRole("heading", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: /Don’t show file selection again/i }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /first\.mkv/i })).toBeChecked();
  });

  it("downloads every file without waiting for magnet metadata", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);
    const onDownloadAll = vi.fn(async () => undefined);
    renderDialog({ files: metadataPendingFiles(), onConfirm, onDownloadAll });

    expect(screen.getByRole("status")).toHaveTextContent(
      "You can download all files without waiting",
    );
    await user.click(
      screen.getByRole("checkbox", { name: /Don’t show file selection again/i }),
    );
    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(onDownloadAll).toHaveBeenCalledWith(true));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("waits for the file list on a host that cannot download all before it", () => {
    renderDialog({ files: metadataPendingFiles(), waitForFileList: true });

    expect(screen.getByRole("status")).toHaveTextContent(
      "You can download once the file list loads",
    );
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("offers explicit cancellation while metadata is pending", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn(async () => undefined);
    renderDialog({ files: metadataPendingFiles(), onCancel });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });

  it("loads the next bounded page near the end of the continuous list", () => {
    const onPage = vi.fn();
    renderDialog({ onPage });
    const list = screen.getByRole("list", { name: "Torrent files" });
    Object.defineProperties(list, {
      scrollTop: { value: 52, configurable: true },
      clientHeight: { value: 52 },
    });

    fireEvent.scroll(list);

    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("virtualizes rows and retains at most three catalog pages", async () => {
    const rows = Array.from({ length: 1_024 }, (_, index) =>
      file(index, `file-${index}.bin`, "1"),
    );
    const view = renderDialog({ files: filePage(0, 4_096, 1_024, rows) });

    expect(screen.getAllByRole("checkbox").length).toBeLessThan(40);
    view.rerender(
      dialogElement({
        files: filePage(1_024, 4_096, 2_048, [file(1_024, "b.bin", "1")]),
      }),
    );
    view.rerender(
      dialogElement({
        files: filePage(2_048, 4_096, 3_072, [file(2_048, "c.bin", "1")]),
      }),
    );
    view.rerender(
      dialogElement({
        files: filePage(3_072, 4_096, null, [file(3_072, "d.bin", "1")]),
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("list", { name: "Torrent files" })).toHaveAttribute(
        "data-cached-page-count",
        "3",
      ),
    );
  });
});

function renderDialog(
  overrides: Partial<
    React.ComponentProps<typeof PendingFileSelectionDialog>
  > = {},
) {
  return render(dialogElement(overrides));
}

function dialogElement(
  overrides: Partial<React.ComponentProps<typeof PendingFileSelectionDialog>> = {},
) {
  return (
    <PendingFileSelectionDialog
      torrent={torrent()}
      files={availableFiles()}
      rootLabel="Downloads"
      queuedCount={0}
      dataUnits="decimal"
      onPage={() => undefined}
      onConfirm={async () => undefined}
      onDownloadAll={async () => undefined}
      onCancel={async () => undefined}
      {...overrides}
    />
  );
}

function torrent(): TorrentRow {
  return {
    id: "t1-00000000000000000000000000000000",
    name: "Example torrent",
    awaitingFileSelection: true,
    pendingFileSelectionPosition: 0,
    fileCatalogId: "a".repeat(64),
    selectableFileCount: 2,
    selectedFileCount: 2,
    selectableFileBytes: "1200",
    selectedFileBytes: "1200",
  } as TorrentRow;
}

function availableFiles(): FileSet {
  const first = file(0, "first.mkv", "1000");
  const second = file(1, "second.srt", "200");
  return {
    state: "available",
    filesystemContentBase: null,
    page: { offset: 0, limit: 1_024, total: 3, nextOffset: 2 },
    order: [first.id, second.id],
    rows: { [first.id]: first, [second.id]: second },
  };
}

function metadataPendingFiles(): FileSet {
  return {
    state: "metadata_pending",
    filesystemContentBase: null,
    page: { offset: 0, limit: 1_024, total: 0, nextOffset: null },
    order: [],
    rows: {},
  };
}

function filePage(
  offset: number,
  total: number,
  nextOffset: number | null,
  files: readonly FileRow[],
): FileSet {
  return {
    state: "available",
    filesystemContentBase: null,
    page: { offset, limit: 1_024, total, nextOffset },
    order: files.map((entry) => entry.id),
    rows: Object.fromEntries(files.map((entry) => [entry.id, entry])),
  };
}

function file(index: number, name: string, lengthBytes: string): FileRow {
  return {
    id: String(index),
    torrentId: "t1-00000000000000000000000000000000",
    index,
    path: [name],
    name,
    folder: "",
    extension: name.split(".").at(-1) ?? "",
    lengthBytes,
    torrentOffsetBytes: index === 0 ? "0" : "1000",
    firstPiece: 0,
    lastPiece: 0,
    selection: "normal",
    padding: false,
    doneBytes: "0",
    verifiedBytes: "0",
    mediaAvailability: "incomplete",
    storagePath: null,
  };
}
