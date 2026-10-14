// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render as renderUnwrapped, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopUpdaterSnapshot } from "../updater/types";
import { SupportDiagnostics } from "./SupportDiagnostics";
import { ToastProvider } from "./Toast";

const render = (ui: Parameters<typeof renderUnwrapped>[0]) =>
  renderUnwrapped(ui, { wrapper: ToastProvider });

const source: DesktopUpdaterSnapshot = {
  info: { version: "0.1.3", buildId: "abcdef1234567", arch: "aarch64",
    target: "aarch64-apple-darwin", bundleType: "app" },
  state: { phase: "error", operation: "check", message: "private token and path" },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("support report preview", () => {
  it("copies the frozen preview and refreshes only on request", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const view = render(<SupportDiagnostics facts={{ about: { connection: "desktop" }, updater: source }} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Prepare diagnostics" }));
    const preview = screen.getByRole("textbox") as HTMLTextAreaElement;
    const original = preview.value;
    view.rerender(<SupportDiagnostics facts={{ about: { connection: "desktop" }, updater: { ...source, state: { phase: "checking", reason: "manual" } } }} />);
    expect(preview.value).toBe(original);
    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(write).toHaveBeenCalledWith(original);
    expect(original).not.toContain("private token");
    expect(screen.getByRole("region", { name: "Notification" })).toHaveTextContent("Diagnostics copied.");
    await user.click(screen.getByRole("button", { name: "Refresh diagnostics" }));
    expect(preview.value).not.toBe(original);
    expect(screen.getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", "https://github.com/kzahel/jstorrent/issues/new");
  });

  it("selects the exact report after clipboard denial without revealing the exception", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("private clipboard detail"));
    render(<SupportDiagnostics facts={{ about: { connection: "desktop" }, updater: source }} />);
    await user.click(screen.getByRole("button", { name: "Prepare diagnostics" }));
    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    const preview = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(preview).toHaveFocus();
    expect(preview.selectionStart).toBe(0);
    expect(preview.selectionEnd).toBe(preview.value.length);
    expect(screen.getByText(/copy it manually/)).toHaveAttribute("role", "status");
    expect(screen.queryByText("private clipboard detail")).not.toBeInTheDocument();
  });

  it("does not mark a refreshed preview copied when an older write finishes", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    vi.spyOn(navigator.clipboard, "writeText").mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<SupportDiagnostics facts={{ about: { connection: "desktop" }, updater: source }} />);
    await user.click(screen.getByRole("button", { name: "Prepare diagnostics" }));
    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await user.click(screen.getByRole("button", { name: "Refresh diagnostics" }));
    await act(async () => { finish(); });
    expect(screen.queryByText("Diagnostics copied.")).not.toBeInTheDocument();
  });
});
