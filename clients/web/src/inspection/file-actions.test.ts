import { describe, expect, it } from "vitest";

import { FILE_ACTIONS, resolveFileActions } from "./file-actions";

describe("file selection actions", () => {
  it("defines one stable Open, Download now, High, Normal, Skip, and Share inventory", () => {
    expect(FILE_ACTIONS.map((action) => [action.group, action.id])).toEqual([
      ["open", "open"],
      ["download", "download_now"],
      ["priority", "high"],
      ["priority", "normal"],
      ["priority", "skip"],
      ["share", "share"],
    ]);
  });

  it("names Share for one or several files and keeps it out of file-change limits", () => {
    const share = (actions: ReturnType<typeof resolveFileActions>) =>
      actions.find((action) => action.id === "share");
    expect(share(resolveFileActions(1, 0, false))).toMatchObject({
      label: "Share file",
      disabled: false,
    });
    expect(share(resolveFileActions(3, 0, false))).toMatchObject({
      label: "Share files",
      disabled: false,
    });
    expect(
      share(resolveFileActions(2, 1, false, "File actions are unavailable.", undefined, true)),
    ).toMatchObject({ disabled: false });
    expect(share(resolveFileActions(0, 0, false))).toMatchObject({
      disabled: true,
      disabledReason: "Select a file to use these actions.",
    });
    expect(
      share(resolveFileActions(1, 0, false, undefined, undefined, false, "No metadata yet.")),
    ).toMatchObject({ disabled: true, disabledReason: "No metadata yet." });
  });

  it("offers Open only for one typed eligible file", () => {
    expect(resolveFileActions(1, 0, false, undefined, "available")[0]).toMatchObject({
      id: "open",
      disabled: false,
    });
    expect(resolveFileActions(1, 0, false, undefined, "streamable")[0]).toMatchObject({
      id: "open",
      disabled: false,
    });
    expect(
      resolveFileActions(1, 0, false, undefined, "unverified").some(
        (action) => action.id === "open",
      ),
    ).toBe(false);
    expect(
      resolveFileActions(2, 0, false, undefined, "available").some(
        (action) => action.id === "open",
      ),
    ).toBe(false);
  });

  it("offers Download now only when at least one target is skipped", () => {
    expect(
      resolveFileActions(1, 0, false).some(
        (action) => action.id === "download_now",
      ),
    ).toBe(false);
    expect(resolveFileActions(2, 1, false)[0]).toMatchObject({
      id: "download_now",
      disabled: false,
    });
  });

  it("shares empty, pending, and product availability reasons", () => {
    expect(resolveFileActions(0, 0, false)[0]).toMatchObject({
      disabled: true,
      disabledReason: "Select a file to use these actions.",
    });
    expect(resolveFileActions(2, 1, true)[0]).toMatchObject({
      disabled: true,
      disabledReason: "Another file action is still in progress.",
    });
    expect(
      resolveFileActions(2, 1, false, "File actions are unavailable.")[0],
    ).toMatchObject({
      disabled: true,
      disabledReason: "File actions are unavailable.",
    });
    expect(
      resolveFileActions(2, 1, false).every((action) => !action.disabled),
    ).toBe(true);
  });

  it("requires restore before Download now on an archived torrent", () => {
    const actions = resolveFileActions(2, 1, false, undefined, undefined, true);
    expect(actions.find((action) => action.id === "download_now")).toMatchObject({
      disabled: true,
      disabledReason: "Restore this archived torrent before downloading files.",
    });
    expect(
      actions
        .filter((action) => action.id !== "download_now")
        .every((action) => !action.disabled),
    ).toBe(true);
  });
});
