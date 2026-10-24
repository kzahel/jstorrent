// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopUpdaterSnapshot } from "../updater/types";
import { UpdateOutcomeNotice } from "./UpdateOutcomeNotice";

const { show } = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("./Toast", () => ({ useToast: () => ({ show }) }));

const snapshot: DesktopUpdaterSnapshot = {
  info: { version: "0.3.2", buildId: "b", target: "darwin", arch: "aarch64", bundleType: "app" },
  state: { phase: "idle" },
  lastOutcome: { version: "0.3.2", succeeded: true, message: "Installed" },
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); show.mockClear(); });

it("waits for foreground interaction and announces an installed version only once", () => {
  let focused = false;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  const mounted = render(<UpdateOutcomeNotice snapshot={snapshot} />);
  act(() => window.dispatchEvent(new Event("focus")));
  expect(show).not.toHaveBeenCalled();
  focused = true;
  act(() => window.dispatchEvent(new Event("focus")));
  expect(show).toHaveBeenCalledOnce();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown")));
  expect(show).toHaveBeenCalledOnce();
  mounted.unmount();
  render(<UpdateOutcomeNotice snapshot={snapshot} />);
  expect(show).toHaveBeenCalledOnce();
});

it("never announces a failed attempt or a version the connected host is not running", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const mounted = render(<UpdateOutcomeNotice snapshot={{ ...snapshot, lastOutcome: { ...snapshot.lastOutcome!, succeeded: false } }} />);
  mounted.rerender(<UpdateOutcomeNotice snapshot={{ ...snapshot, lastOutcome: { ...snapshot.lastOutcome!, version: "0.3.3" } }} />);
  expect(show).not.toHaveBeenCalled();
});

it("introduces enabled automatic updates only in foreground and combines the installed notice", () => {
  let focused = false;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  const enabled = { ...snapshot, automaticAvailable: true, automaticUpdates: true };
  const mounted = render(<UpdateOutcomeNotice snapshot={enabled} />);
  expect(show).not.toHaveBeenCalled();
  focused = true;
  act(() => window.dispatchEvent(new Event("focus")));
  expect(show).toHaveBeenCalledOnce();
  expect(show.mock.calls[0]![0].message).toContain("Updated to 0.3.2");
  expect(show.mock.calls[0]![0].message).toContain("15 minutes");
  expect(show.mock.calls[0]![0].message).toContain("Settings");
  mounted.unmount();
  render(<UpdateOutcomeNotice snapshot={enabled} />);
  expect(show).toHaveBeenCalledOnce();
});

it("does not introduce disabled or unavailable automatic installation", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const base = { ...snapshot, lastOutcome: undefined };
  const mounted = render(<UpdateOutcomeNotice snapshot={{ ...base, automaticAvailable: true, automaticUpdates: false }} />);
  mounted.rerender(<UpdateOutcomeNotice snapshot={{ ...base, automaticAvailable: false, automaticUpdates: true }} />);
  expect(show).not.toHaveBeenCalled();
});
