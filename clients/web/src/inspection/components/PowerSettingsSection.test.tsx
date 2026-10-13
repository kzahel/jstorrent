// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopPower,
  DesktopPowerSettings,
} from "../desktop-power/types";
import { PowerSettingsSection } from "./PowerSettingsSection";

const DEFAULTS: DesktopPowerSettings = {
  prevent_sleep_during_active_downloads: true,
};

afterEach(cleanup);

describe("desktop power settings", () => {
  it("persists the accessible default-on toggle immediately", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (settings: DesktopPowerSettings) => settings);
    render(<PowerSettingsSection power={controller(DEFAULTS, save)} />);

    const toggle = screen.getByRole("checkbox", {
      name: /Prevent sleep while downloading/,
    });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({
      prevent_sleep_during_active_downloads: false,
    });
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Power setting saved");
  });

  it("rolls back a failed save and presents the failure", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {
      throw new Error("disk is read-only");
    });
    render(<PowerSettingsSection power={controller(DEFAULTS, save)} />);

    const toggle = screen.getByRole("checkbox", {
      name: /Prevent sleep while downloading/,
    });
    await user.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Power setting was not saved: disk is read-only",
    );
    expect(toggle).toBeChecked();
  });
});

function controller(
  snapshot: DesktopPowerSettings,
  save: DesktopPower["save"],
): DesktopPower {
  return { getSnapshot: () => snapshot, save };
}
