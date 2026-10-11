// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { openTauriExternalUrl } from "./tauri-external-links";

afterEach(clearMocks);

it("uses the actual opener binding with the default browser and preserves rejection", async () => {
  const calls: unknown[] = [];
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (args && "url" in args && args.url === "file:///private") throw new Error("denied");
  });
  await openTauriExternalUrl("https://github.com/kzahel/rstorrent/issues");
  expect(calls).toEqual([{ command: "plugin:opener|open_url", args: {
    url: "https://github.com/kzahel/rstorrent/issues", with: undefined,
  } }]);
  await expect(openTauriExternalUrl("file:///private")).rejects.toThrow("denied");
});
