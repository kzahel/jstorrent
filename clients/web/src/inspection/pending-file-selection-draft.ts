import type { FileRow, TorrentRow } from "./model";

const MAX_FILES = 374_998;
export const MAX_SELECTION_RANGES = 4_096;
export type SelectionBase = "current" | "all" | "none";
export interface SelectionRange {
  start: number;
  endExclusive: number;
  selected: boolean;
}

/** Bounded, immutable draft; two bits per file, independent of cached pages. */
export class PendingSelectionDraft {
  constructor(
    readonly base: SelectionBase = "current",
    private readonly touched = new Uint8Array(),
    private readonly values = new Uint8Array(),
    readonly rangeCount = 0,
    private readonly countDelta = 0,
    private readonly bytesDelta = 0n,
    readonly changedFileCount = 0,
  ) {}

  private bit(mask: Uint8Array, index: number): boolean {
    return index >= 0 && ((mask[index >>> 3] ?? 0) & (1 << (index & 7))) !== 0;
  }
  private rangeStart(index: number): number {
    return this.bit(this.touched, index) &&
      (!this.bit(this.touched, index - 1) ||
        this.bit(this.values, index - 1) !== this.bit(this.values, index))
      ? 1
      : 0;
  }
  private baseline(file: FileRow): boolean {
    return file.safety?.blocked === true
      ? false
      : this.base === "all"
        ? true
        : this.base === "none"
          ? false
          : file.selection !== "skipped";
  }
  selected(file: FileRow): boolean {
    return file.safety?.blocked === true
      ? false
      : this.bit(this.touched, file.index)
        ? this.bit(this.values, file.index)
        : this.baseline(file);
  }
  toggle(
    file: FileRow,
    maximumChangedFiles = MAX_FILES,
  ): PendingSelectionDraft | null {
    if (file.safety?.blocked === true) return this;
    if (
      file.padding ||
      !Number.isInteger(file.index) ||
      file.index < 0 ||
      file.index >= MAX_FILES
    )
      return null;
    const selected = !this.selected(file);
    const changedFileCount =
      this.changedFileCount + (this.bit(this.touched, file.index) ? -1 : 1);
    if (changedFileCount > maximumChangedFiles) return null;
    const length = Math.max(this.touched.length, (file.index >>> 3) + 1);
    const touched = new Uint8Array(length);
    touched.set(this.touched);
    const values = new Uint8Array(length);
    values.set(this.values);
    const byte = file.index >>> 3,
      bit = 1 << (file.index & 7);
    touched[byte] =
      ((touched[byte] ?? 0) & ~bit) |
      (selected !== this.baseline(file) ? bit : 0);
    values[byte] = ((values[byte] ?? 0) & ~bit) | (selected ? bit : 0);
    const next = new PendingSelectionDraft(
      this.base,
      touched,
      values,
      0,
      this.countDelta + (selected ? 1 : -1),
      this.bytesDelta + BigInt(file.lengthBytes) * (selected ? 1n : -1n),
      changedFileCount,
    );
    const ranges =
      this.rangeCount -
      this.rangeStart(file.index) -
      this.rangeStart(file.index + 1) +
      next.rangeStart(file.index) +
      next.rangeStart(file.index + 1);
    return ranges > MAX_SELECTION_RANGES
      ? null
      : new PendingSelectionDraft(
          this.base,
          touched,
          values,
          ranges,
          next.countDelta,
          next.bytesDelta,
          changedFileCount,
        );
  }
  summary(torrent: TorrentRow): { count: number; bytes: bigint } {
    const count =
      this.base === "all"
        ? (torrent.selectableFileCount ?? 0) -
          (torrent.safetySummary?.blocked_file_count ?? 0)
        : this.base === "none"
          ? 0
          : (torrent.selectedFileCount ?? 0);
    const bytes =
      this.base === "all"
        ? BigInt(torrent.selectableFileBytes ?? "0") -
          BigInt(torrent.safetySummary?.blocked_file_bytes ?? "0")
        : this.base === "none"
          ? 0n
          : BigInt(torrent.selectedFileBytes ?? "0");
    return { count: count + this.countDelta, bytes: bytes + this.bytesDelta };
  }
  compactOverrides(): SelectionRange[] {
    const ranges: SelectionRange[] = [];
    for (let index = 0; index < this.touched.length * 8; index++) {
      if (!this.bit(this.touched, index)) continue;
      const selected = this.bit(this.values, index),
        previous = ranges.at(-1);
      if (previous?.endExclusive === index && previous.selected === selected)
        previous.endExclusive++;
      else ranges.push({ start: index, endExclusive: index + 1, selected });
    }
    return ranges;
  }
}
