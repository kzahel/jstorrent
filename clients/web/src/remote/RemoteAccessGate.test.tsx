// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authorization, subtle, wasm } from "../test-support/remote-connection";
import { ScriptedRemoteHost } from "../test-support/scripted-remote-host";
import { LiveApplication } from "../inspection/live/LiveApplication";
import { RemoteOnlyApplicationClient } from "../remote-application-client";
import type { RemoteClientStore, StoredRemoteClient } from "../remote-client-store";
import { RemoteAccessGate } from "./RemoteAccessGate";

describe("remote access gate", () => {
  let host: ScriptedRemoteHost;
  let application: LiveApplication | undefined;
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    host = new ScriptedRemoteHost();
    vi.stubGlobal("WebSocket", function (url: string) {
      return host.connect(url);
    });
    vi.stubGlobal("crypto", { subtle, getRandomValues: (bytes: Uint8Array) => bytes.fill(1) });
  });

  afterEach(async () => {
    await application?.close();
    application = undefined;
    for (const socket of host.sockets) socket.close();
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows an explicit private or shared browser choice after resume lookup", async () => {
    renderGate(store());
    expect(
      await screen.findByRole("heading", {
        name: "Your torrents, from this browser",
      }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: /Private/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Shared/ })).not.toBeChecked();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("requires an explicit trust clear after a changed host identity", async () => {
    const clearHost = vi.fn(async () => undefined);
    localStorage.setItem("rstorrent.remote.last-username.v1", "alice");
    host.mode = "changed";
    renderGate(store({ clearHost, load: async () => remembered() }), async (client) => {
      await client.hello();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "different authenticated host identity",
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear old host trust" }));
    await waitFor(() => expect(clearHost).toHaveBeenCalledWith("alice"));
    expect(await screen.findByLabelText("Password")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Confirm the host was intentionally reset");
  });

  it("retains authorization through interrupted resumes and recovers views without remounting", async () => {
    host.interruptResumes = 2;
    localStorage.setItem("rstorrent.remote.last-username.v1", "alice");
    const clientStore = store({ load: async () => remembered(), clearAuthorization: vi.fn() });
    const onConnected = vi.fn(async (client: import("../api/client").ApplicationViewClient) => {
      application = await LiveApplication.open(new RemoteOnlyApplicationClient(client));
    });
    renderGate(clientStore, onConnected);
    await waitFor(() => expect(application).toBeDefined());
    const original = application;
    const states: string[] = [];
    const stop = application!.subscribe((update) => {
      if (update.type === "snapshot") states.push(update.snapshot.session.connection.type);
    });
    host.sockets.at(-1)!.close(1006, "phone lost connection");
    await waitFor(() => expect(host.sockets).toHaveLength(4));
    await waitFor(() => expect(states.at(-1)).toBe("connected"));
    expect(states).toContain("reconnecting");
    expect(application).toBe(original);
    // There is one acquisition per initial attempt; recovery stays inside the
    // successful application's view controller instead of re-entering the gate.
    expect(onConnected).toHaveBeenCalledTimes(3);
    expect(clientStore.clearAuthorization).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    await waitFor(() =>
      expect(
        host.sockets
          .at(-1)!
          .sent.some((record) => new TextDecoder().decode(record).includes('"type":"ack"')),
      ).toBe(true),
    );
    stop();
  });

  it("keeps authorization and stops acquisition on a verification failure", async () => {
    host.mode = "invalid";
    localStorage.setItem("rstorrent.remote.last-username.v1", "alice");
    const clientStore = store({ load: async () => remembered(), clearAuthorization: vi.fn() });
    renderGate(clientStore, async (client) => {
      await client.hello();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to start secure remote access",
    );
    expect(clientStore.clearAuthorization).not.toHaveBeenCalled();
    expect(host.sockets).toHaveLength(1);
  });

  it("propagates changed-host evidence through view recovery without erasing trust", async () => {
    localStorage.setItem("rstorrent.remote.last-username.v1", "alice");
    const clientStore = store({
      load: async () => remembered(),
      clearAuthorization: vi.fn(),
      clearHost: vi.fn(),
    });
    renderGate(clientStore, async (client) => {
      application = await LiveApplication.open(new RemoteOnlyApplicationClient(client));
    });
    await waitFor(() => expect(application).toBeDefined());
    const states: string[] = [];
    const stop = application!.subscribe((update) => {
      if (update.type === "snapshot") states.push(update.snapshot.session.connection.type);
    });
    host.mode = "changed";
    host.sockets[0]!.close(1006, "reconnect to changed route");
    await waitFor(() => expect(states.at(-1)).toBe("stopped"));
    expect(host.sockets).toHaveLength(2);
    expect(clientStore.clearAuthorization).not.toHaveBeenCalled();
    expect(clientStore.clearHost).not.toHaveBeenCalled();
    stop();
  });

  it("recovers a cold saved login on online after exhausting initial retries", async () => {
    vi.useFakeTimers();
    host.mode = "offline";
    localStorage.setItem("rstorrent.remote.last-username.v1", "alice");
    const clientStore = store({ load: async () => remembered(), clearAuthorization: vi.fn() });
    const attached = vi.fn();
    renderGate(clientStore, async (client) => {
      await client.hello();
      attached();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(host.sockets).toHaveLength(5);
    expect(clientStore.clearAuthorization).not.toHaveBeenCalled();
    host.mode = "online";
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
      for (let index = 0; index < 30; index++) await Promise.resolve();
    });
    expect(attached).toHaveBeenCalledTimes(1);
    expect(host.sockets).toHaveLength(6);
  });
});

function renderGate(
  clientStore: RemoteClientStore,
  onConnected: import("./RemoteAccessGate").RemoteAccessGateProps["onConnected"] = async () =>
    undefined,
): void {
  render(
    <RemoteAccessGate
      relayUrl="wss://127.0.0.1:7443"
      clientBuild="test-build"
      crypto={wasm}
      store={clientStore}
      onConnected={onConnected}
    />,
  );
}

function remembered(): StoredRemoteClient {
  const value = authorization();
  return { identity: value, authorization: value, key: {} as CryptoKey };
}

function store(overrides: Partial<RemoteClientStore> = {}): RemoteClientStore {
  return {
    load: async (): Promise<StoredRemoteClient | undefined> => undefined,
    saveTrust: async () => undefined,
    saveAuthorization: async () => undefined,
    clearAuthorization: async () => undefined,
    clearHost: async () => undefined,
    ...overrides,
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
