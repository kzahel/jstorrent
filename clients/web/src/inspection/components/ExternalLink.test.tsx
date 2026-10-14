// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalUrlProvider } from "../external-links";
import { ExternalLink } from "./ExternalLink";
import { SupportDiagnostics } from "./SupportDiagnostics";
import { ToastProvider } from "./Toast";

afterEach(cleanup);
const url = "https://github.com/kzahel/jstorrent/issues";

describe("external links", () => {
  it("leaves browser navigation and modified clicks to the native anchor", () => {
    render(<ExternalLink href={url}>Issues</ExternalLink>);
    const link = screen.getByRole("link", { name: "Issues" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent(link, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }))).toBe(true);
  });

  it("routes support links through the injected desktop opener", async () => {
    const user = userEvent.setup();
    const openUrl = vi.fn(async () => undefined);
    render(<ToastProvider><ExternalUrlProvider openUrl={openUrl}><SupportDiagnostics facts={{ about: {}, updater: {
      info: { version: "0.3.0", buildId: "development", arch: "aarch64", target: "aarch64-apple-darwin", bundleType: "app" },
      state: { phase: "idle" },
    } }} /></ExternalUrlProvider></ToastProvider>);
    for (const name of ["Known issues", "Report a problem", "Privacy and recovery guidance"]) {
      const link = screen.getByRole("link", { name });
      await user.click(link);
      expect(openUrl).toHaveBeenLastCalledWith(link.getAttribute("href"));
    }
    expect(openUrl).toHaveBeenCalledTimes(3);
  });

  it("routes keyboard, modified and middle clicks once without webview navigation", async () => {
    const user = userEvent.setup();
    const openUrl = vi.fn(async () => undefined);
    render(<ExternalUrlProvider openUrl={openUrl}><ExternalLink href={url}>Issues</ExternalLink></ExternalUrlProvider>);
    const link = screen.getByRole("link");
    link.focus();
    await user.keyboard("{Enter}");
    expect(openUrl).toHaveBeenCalledTimes(1);
    await act(async () => { expect(fireEvent.click(link, { metaKey: true })).toBe(false); });
    await act(async () => { expect(fireEvent(link, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }))).toBe(false); });
    expect(openUrl).toHaveBeenCalledTimes(3);
    fireEvent.contextMenu(link);
    expect(openUrl).toHaveBeenCalledTimes(3);
  });

  it("bounds pending opens, hides raw failures and allows retry", async () => {
    let reject!: (error: Error) => void;
    const openUrl = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }))
      .mockResolvedValue(undefined);
    render(<ExternalUrlProvider openUrl={openUrl}><ExternalLink href={url}>Issues</ExternalLink></ExternalUrlProvider>);
    const link = screen.getByRole("link");
    fireEvent.click(link);
    fireEvent.click(link);
    expect(openUrl).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("private plugin details")));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not open the link. Please try again.");
    expect(screen.queryByText("private plugin details")).toBeNull();
    await act(async () => { fireEvent.click(link); });
    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
