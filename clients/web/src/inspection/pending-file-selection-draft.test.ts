import { describe, expect, it } from "vitest";
import {
  PendingSelectionDraft,
  MAX_SELECTION_RANGES,
} from "./pending-file-selection-draft";
import type { FileRow, TorrentRow } from "./model";
const file = (index: number): FileRow => ({
  id: String(index),
  index,
  torrentId: "test",
  folder: "",
  extension: "",
  torrentOffsetBytes: "0",
  firstPiece: 0,
  lastPiece: 0,
  doneBytes: "0",
  verifiedBytes: "0",
  mediaAvailability: "incomplete",
  storagePath: null,
  name: "file",
  path: ["file"],
  padding: false,
  lengthBytes: "2",
  selection: "normal",
});

describe("bitmap file selection draft", () => {
  it("compacts ten thousand adjacent edits and undoes an edit without keeping page rows", () => {
    let draft = new PendingSelectionDraft();
    for (let i = 0; i < 10_000; i++) draft = draft.toggle(file(i))!;
    expect(draft.rangeCount).toBe(1);
    expect(draft.changedFileCount).toBe(10_000);
    expect(draft.compactOverrides()).toEqual([
      { start: 0, endExclusive: 10_000, selected: false },
    ]);
    draft = draft.toggle(file(5000))!;
    expect(draft.rangeCount).toBe(2);
    expect(draft.selected(file(5000))).toBe(true);
    expect(
      draft.summary({
        selectedFileCount: 10_000,
        selectedFileBytes: "20000",
      } as TorrentRow),
    ).toEqual({ count: 1, bytes: 2n });
  });
  it("bounds normalized sparse ranges rather than changed file count", () => {
    let draft = new PendingSelectionDraft();
    for (let i = 0; i < MAX_SELECTION_RANGES; i++)
      draft = draft.toggle(file(i * 2))!;
    expect(draft.rangeCount).toBe(MAX_SELECTION_RANGES);
    expect(draft.toggle(file(MAX_SELECTION_RANGES * 2))).toBeNull();
    const merged = draft.toggle(file(1))!;
    expect(merged.rangeCount).toBe(MAX_SELECTION_RANGES - 1);
    expect(merged.toggle(file(MAX_SELECTION_RANGES * 2))).not.toBeNull();
  });
  it("retains the older host's changed-file limit when the capability is absent", () => {
    let draft = new PendingSelectionDraft();
    for (let index = 0; index < 4096; index++)
      draft = draft.toggle(file(index), 4096)!;
    expect(draft.toggle(file(4096), 4096)).toBeNull();
    expect(draft.toggle(file(4096))).not.toBeNull();
    expect(draft.toggle(file(0), 4096)?.changedFileCount).toBe(4095);
  });
  it("keeps safety blocked files unchecked under All", () => {
    const draft = new PendingSelectionDraft("all");
    const blocked = {
      ...file(0),
      safety: {
        matched_extension: ".exe",
        preset: "recommended" as const,
        blocked: true,
        overridden: false,
      },
    };
    expect(draft.selected(blocked)).toBe(false);
    expect(draft.toggle(blocked)).toBe(draft);
    expect(
      draft.summary({
        selectableFileCount: 10,
        selectableFileBytes: "1000",
        safetySummary: { blocked_file_count: 2, blocked_file_bytes: "300" },
      } as TorrentRow),
    ).toEqual({ count: 8, bytes: 700n });
  });
});
