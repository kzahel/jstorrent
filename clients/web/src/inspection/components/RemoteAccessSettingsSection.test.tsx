// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render as renderUnwrapped, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopRemoteAccess,
  DesktopRemoteAccessState,
  RemoteSecuritySnapshot,
} from "../remote-access/types";
import { RemoteAccessSettingsSection } from "./RemoteAccessSettingsSection";
import { ToastProvider } from "./Toast";

const render = (ui: Parameters<typeof renderUnwrapped>[0]) =>
  renderUnwrapped(ui, { wrapper: ToastProvider });

afterEach(() => cleanup());

describe("desktop remote security settings", () => {
  it("renders every authorization, circuit, and audit category without a filter", async () => {
    const revoke = vi.fn(async () => undefined);
    const setDirectFileTransfersEnabled = vi.fn(async () => enabledState().security!);
    const stopDirectFileTransfers = vi.fn(async () => enabledState().security!);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <RemoteAccessSettingsSection
        remoteAccess={remoteAccess(enabledState(), {
          scope: "remote",
          currentClientId: "client-one",
          revoke,
          setDirectFileTransfersEnabled,
          stopDirectFileTransfers,
        })}
      />,
    );
    expect(await screen.findByText("Authorized browsers")).toBeVisible();
    expect(screen.getAllByText("Laptop browser")).toHaveLength(2);
    expect(screen.getByText("Phone browser")).toBeVisible();
    expect(screen.getByText("Live circuits")).toBeVisible();
    expect(screen.getByText("Current security ledger")).toBeVisible();
    expect(screen.getByText("Direct file transfers")).toBeVisible();
    expect(screen.getByText("direct file completed")).toBeVisible();
    expect(screen.getByText(/torrent torrent-one · file index 2 · 5 bytes/)).toBeVisible();
    expect(screen.getByText("full login succeeded")).toBeVisible();
    expect(screen.getByText("This browser")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Disable remote access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.getByText(/Ended browser authorizations \(1\)/)).toBeVisible();
    expect(screen.getByText(/Failed authentication pressure \(1 buckets\)/)).toBeVisible();

    const laptop = screen.getAllByText("Laptop browser")[0]?.closest("li");
    if (laptop === null || laptop === undefined) {
      throw new Error("missing laptop record");
    }
    await userEvent.click(within(laptop).getByRole("button", { name: "Revoke" }));
    expect(revoke).toHaveBeenCalledWith("client-one");
    await userEvent.click(screen.getByRole("button", { name: "Disable direct file transfers" }));
    expect(setDirectFileTransfersEnabled).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Stop active transfers" }));
    expect(stopDirectFileTransfers).toHaveBeenCalledOnce();
  });

  it("truthfully reports when the remote owner is unavailable", async () => {
    render(
      <RemoteAccessSettingsSection
        remoteAccess={remoteAccess({ configured: false, security: null })}
      />,
    );
    expect(await screen.findByText("Unavailable")).toBeVisible();
    expect(screen.getByText(/could not establish protected remote-access storage/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Enable remote/ })).not.toBeInTheDocument();
  });
});

function remoteAccess(
  state: DesktopRemoteAccessState,
  overrides: Partial<DesktopRemoteAccess> = {},
): DesktopRemoteAccess {
  return {
    scope: "local",
    state: async () => state,
    enable: async () => {
      throw new Error("not expected");
    },
    rename: async () => undefined,
    revoke: async () => undefined,
    revokeAllOther: async () => 0,
    closeCircuit: async () => undefined,
    requirePasswordEverywhere: async () => 0,
    changePassphrase: async () => 0,
    disable: async () => ({
      authority_file_removed: true,
      route_released: true,
    }),
    recover: async () => {
      throw new Error("not expected");
    },
    clearHistory: async () => false,
    setDirectFileTransfersEnabled: async () => {
      throw new Error("not expected");
    },
    stopDirectFileTransfers: async () => {
      throw new Error("not expected");
    },
    ...overrides,
  };
}

function enabledState(): DesktopRemoteAccessState {
  const snapshot = securitySnapshot();
  return {
    configured: true,
    security: {
      enabled: true,
      username: "alice",
      route: "alice",
      relay_id: "relay-id",
      host_pin: "host-identity",
      authority: snapshot,
      retained_history: null,
      live_circuits: [
        {
          circuit_id: "circuit-one",
          client_id: "client-one",
          authentication_method: "resume",
          connection_generation: 3,
          started: 1_780_000_000_000,
          last_activity: 1_780_000_001_000,
          route: "alice",
        },
      ],
      direct_file: {
        compiled: true,
        enabled: true,
        state: "idle",
        active_circuit_id: "circuit-one",
        bytes_sent: 0,
        candidate_class: null,
        active_tasks: 0,
        open_sockets: 0,
        active_requests: 0,
        queued_bytes: 0,
      },
    },
  };
}

function securitySnapshot(): RemoteSecuritySnapshot {
  return {
    generation: 9,
    authorization_generation: 4,
    clients: [
      client("client-one", "Laptop browser"),
      client("client-two", "Phone browser"),
    ],
    tombstones: [
      {
        client_id: "old-client",
        label: "Old browser",
        fingerprint: "SHA256:old",
        created: 1_770_000_000_000,
        last_seen: 1_771_000_000_000,
        ended: 1_772_000_000_000,
        state: "revoked",
      },
    ],
    events: [
      {
        event_id: "event-one",
        timestamp: 1_780_000_000_000,
        kind: "full_login_succeeded",
        result: "succeeded",
        client_id: "client-one",
        circuit_id: "circuit-one",
        authentication_method: "password",
        route: "alice",
        client_build: "test-build",
        reason_class: null,
        direct_file: null,
      },
      {
        event_id: "event-two",
        timestamp: 1_780_000_002_000,
        kind: "direct_file_completed",
        result: "succeeded",
        client_id: "client-one",
        circuit_id: "circuit-one",
        authentication_method: "resume",
        route: "alice",
        client_build: null,
        reason_class: "complete",
        direct_file: {
          torrent_id: "torrent-one",
          file_index: 2,
          byte_count: 5,
          candidate_class: "host",
        },
      },
    ],
    failed_attempts: [
      {
        bucket_start: 1_780_000_000_000,
        kind: "password",
        route_class: "known",
        attempts: 2,
      },
    ],
  };
}

function client(clientId: string, label: string) {
  return {
    client_id: clientId,
    label,
    fingerprint: `SHA256:${clientId}`,
    created: 1_780_000_000_000,
    last_full_login: 1_780_000_001_000,
    last_resume: null,
    last_seen: 1_780_000_002_000,
    idle_expires: 1_790_000_000_000,
    absolute_expires: 1_800_000_000_000,
    state: "current" as const,
    client_build: "test-build",
    route_observation: "local relay",
    browser_observation: "Chrome",
  };
}
