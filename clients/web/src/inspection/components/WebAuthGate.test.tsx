// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebAuthClient } from "../../web-auth-client";
import { WebAuthGate } from "./WebAuthGate";

afterEach(cleanup);

describe("WebAuthGate", () => {
  it("offers low-friction first-run choices", async () => {
    const user = userEvent.setup();
    const setPolicy = vi.fn().mockResolvedValue(undefined);
    const onAuthorized = vi.fn().mockResolvedValue(undefined);
    render(
      <WebAuthGate
        client={{ setPolicy } as unknown as WebAuthClient}
        initialStatus={{
          available: true,
          state: "initial_window_open",
          remaining_seconds: 600,
        }}
        onAuthorized={onAuthorized}
      />,
    );
    expect(screen.getByText(/Initial setup is open/i)).toHaveTextContent("10:00");
    await user.click(
      screen.getByRole("button", { name: /Remember this browser/ }),
    );
    expect(setPolicy).toHaveBeenCalledWith("paired", expect.any(String));
    expect(onAuthorized).toHaveBeenCalledOnce();
  });

  it("explains expired setup and cookie-loss recovery", () => {
    const client = {} as WebAuthClient;
    const onAuthorized = vi.fn().mockResolvedValue(undefined);
    const first = render(
      <WebAuthGate
        client={client}
        initialStatus={{ available: true, state: "initial_window_expired" }}
        onAuthorized={onAuthorized}
      />,
    );
    expect(screen.getByRole("heading", { name: "Restart to finish setup" })).toBeVisible();
    expect(screen.getByText(/Setup is closed/i)).toBeVisible();

    first.unmount();
    render(
      <WebAuthGate
        client={client}
        initialStatus={{ available: true, state: "session_required" }}
        onAuthorized={onAuthorized}
      />,
    );
    expect(screen.getByText(/Settings → Web access/i)).toBeVisible();
    expect(screen.getByText(/--pairing-window/i)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Four-digit code" })).toHaveAttribute(
      "maxlength",
      "4",
    );
  });
});
