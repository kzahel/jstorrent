import { describe, expect, it } from "vitest";

import type { ApiHello } from "./api";
import type { ApplicationViewClient } from "./api/client";
import { RemoteOnlyApplicationClient } from "./remote-application-client";

describe("remote-only application capability profile", () => {
  it("preserves media catalog inspection while excluding bulk/platform methods", async () => {
    const inner = {
      hello: async () => hello(),
    } as unknown as ApplicationViewClient;
    const remote = new RemoteOnlyApplicationClient(inner);
    expect((await remote.hello()).capabilities).toEqual([
      "torrent_list",
      "torrent_media",
      "torrent_files",
    ]);
    expect("addTorrentBytes" in remote).toBe(false);
    expect("createMediaUrl" in remote).toBe(false);
    expect("prepareMediaOpen" in remote).toBe(false);
    await expect(remote.chooseDownloadRoot({})).rejects.toThrow(
      "Folder selection is unavailable",
    );
  });
});

function hello(): ApiHello {
  return {
    api: { current: 1, minimum: 1 },
    encodings: ["json"],
    deliveries: ["long_poll", "stream"],
    capabilities: ["torrent_list", "torrent_media", "torrent_files"],
    limits: {
      max_view_sets_per_owner: 8,
      max_views_per_set: 16,
      max_view_id_bytes: 64,
      min_queue_bytes: 1024,
      default_queue_bytes: 65_536,
      max_queue_bytes: 1_048_576,
      max_snapshot_bytes: 16_777_216,
      max_wait_millis: 20_000,
      lease_millis: "30000",
    },
  };
}
