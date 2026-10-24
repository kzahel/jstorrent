// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render as renderUnwrapped, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebAuthClient } from "../../web-auth-client";
import { WebAccessSettingsSection } from "./WebAccessSettingsSection";
import { ToastProvider } from "./Toast";

const render = (ui: Parameters<typeof renderUnwrapped>[0]) =>
  renderUnwrapped(ui, { wrapper: ToastProvider });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WebAccessSettingsSection", () => {
  it("lists sessions and generates a four-digit handoff", async () => {
    const user = userEvent.setup();
    const now = Math.floor(Date.now() / 1_000);
    const client = {
      status: vi.fn().mockResolvedValue({
        available: true,
        state: "session_valid",
        current_session: {
          id: "1".repeat(32),
          label: "Current browser",
          created_at: now - 100,
          last_used_at: now,
          expires_at: now + 1_000,
          current: true,
        },
      }),
      sessions: vi.fn().mockResolvedValue([
        {
          id: "1".repeat(32),
          label: "Current browser",
          created_at: now - 100,
          last_used_at: now,
          expires_at: now + 1_000,
          current: true,
        },
        {
          id: "2".repeat(32),
          label: "Other browser",
          created_at: now - 50,
          last_used_at: now - 10,
          expires_at: now + 1_000,
          current: false,
        },
      ]),
      createPairingTicket: vi.fn().mockResolvedValue({
        code: "0427",
        expires_at: now + 600,
      }),
    } as unknown as WebAuthClient;
    render(
      <WebAccessSettingsSection client={client} onSignedOut={vi.fn()} />,
    );
    expect(await screen.findByText("Current browser")).toBeVisible();
    expect(screen.getByText("Other browser")).toBeVisible();
    expect(screen.getByText("2 of 32 remembered sessions")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Generate code" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Pairing code 0 4 2 7")).toHaveTextContent("0427"),
    );
    expect(screen.getByText(/Expires in (?:10:00|9:59)/)).toBeVisible();
  });
});
