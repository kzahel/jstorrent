// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render as renderUnwrapped, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopNotifications,
  DesktopNotificationSettings,
} from "../desktop-notifications/types";
import { NotificationsSettingsSection } from "./NotificationsSettingsSection";
import { ToastProvider } from "./Toast";

const render = (ui: Parameters<typeof renderUnwrapped>[0]) =>
  renderUnwrapped(ui, { wrapper: ToastProvider });

const DEFAULTS: DesktopNotificationSettings = {
  notify_download_complete: true,
  notify_needs_attention: true,
  notify_while_focused: true,
};

afterEach(cleanup);

describe("notification settings", () => {
  it("persists each accessible toggle immediately", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (settings: DesktopNotificationSettings) => settings);
    render(
      <NotificationsSettingsSection
        notifications={controller(DEFAULTS, save)}
      />,
    );

    const completion = screen.getByRole("checkbox", {
      name: /Download complete/,
    });
    expect(completion).toBeChecked();
    await user.click(completion);

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({
      ...DEFAULTS,
      notify_download_complete: false,
    });
    expect(completion).not.toBeChecked();
    // The switch shows the result; success adds no text.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it("rolls back a failed save and presents the failure", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {
      throw new Error("disk is read-only");
    });
    render(
      <NotificationsSettingsSection
        notifications={controller(DEFAULTS, save)}
      />,
    );

    const focused = screen.getByRole("checkbox", {
      name: /Notify while JSTorrent is focused/,
    });
    await user.click(focused);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Notification settings were not saved: disk is read-only",
    );
    expect(focused).toBeChecked();
  });
});

function controller(
  snapshot: DesktopNotificationSettings,
  save: DesktopNotifications["save"],
): DesktopNotifications {
  return { getSnapshot: () => snapshot, save };
}
