// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ShareSettingsSection } from "./ShareSettingsSection";

const stored = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
});

afterAll(() => {
  if (original === undefined) Reflect.deleteProperty(globalThis, "localStorage");
  else Object.defineProperty(globalThis, "localStorage", original);
});

afterEach(() => {
  cleanup();
  stored.clear();
});

describe("share settings", () => {
  it("shows Ask each time by default and saves a new choice at once", async () => {
    const user = userEvent.setup();
    render(<ShareSettingsSection />);
    const group = screen.getByRole("group", { name: "Your address in share links" });
    expect(group).toHaveAccessibleDescription("You're asked when you copy a share link.");
    expect(screen.getByRole("radio", { name: "Ask each time" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Never include" }));
    expect(JSON.parse(stored.get("rstorrent.presentation.share")!)).toEqual({
      version: 1,
      peerHint: "omit",
    });
    expect(group).toHaveAccessibleDescription("Share links never include your address.");
  });

  it("reflects a remembered choice", () => {
    stored.set(
      "rstorrent.presentation.share",
      JSON.stringify({ version: 1, peerHint: "include" }),
    );
    render(<ShareSettingsSection />);
    expect(screen.getByRole("radio", { name: "Always include" })).toBeChecked();
  });
});
