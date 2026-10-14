// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOAST_LONG_MS,
  TOAST_SHORT_MS,
  ToastProvider,
  useToast,
  type ToastOptions,
} from "./Toast";

let show: (toast: ToastOptions) => void;
let dismiss: (key?: string) => void;

function Probe() {
  ({ show, dismiss } = useToast());
  return null;
}

function region() {
  return screen.queryByRole("region", { name: "Notification" });
}

beforeEach(() => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("toast", () => {
  it("announces through a live region mounted before the first toast", () => {
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    act(() => show({ message: "Magnet link copied" }));
    expect(status).toHaveTextContent("Magnet link copied");
    expect(region()).toHaveTextContent("Magnet link copied");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes an info toast after the short duration", () => {
    act(() => show({ message: "Removed Sintel" }));
    act(() => vi.advanceTimersByTime(TOAST_SHORT_MS - 1));
    expect(region()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(region()).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps a toast with an action for the long duration and runs it once", () => {
    const onAction = vi.fn();
    act(() => show({ message: "Archived Sintel", action: { label: "Undo", onAction } }));
    act(() => vi.advanceTimersByTime(TOAST_SHORT_MS));
    expect(region()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(region()).not.toBeInTheDocument();
  });

  it("closes an action toast after the long duration", () => {
    act(() => show({ message: "Archived Sintel", action: { label: "Undo", onAction: () => {} } }));
    act(() => vi.advanceTimersByTime(TOAST_LONG_MS));
    expect(region()).not.toBeInTheDocument();
  });

  it("keeps errors until dismissed and marks them as alerts", () => {
    act(() => show({ tone: "error", message: "disk is read-only" }));
    act(() => vi.advanceTimersByTime(TOAST_LONG_MS * 10));
    expect(screen.getByRole("alert")).toHaveTextContent("disk is read-only");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(region()).not.toBeInTheDocument();
  });

  it("replaces the current toast instead of queueing", () => {
    act(() => show({ tone: "error", message: "first failure" }));
    act(() => show({ message: "Magnet link copied" }));
    expect(region()).toHaveTextContent("Magnet link copied");
    expect(screen.queryByText("first failure")).not.toBeInTheDocument();
  });

  it("pauses while hovered or focused", () => {
    act(() => show({ message: "Removed Sintel" }));
    const toast = region()!;
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(TOAST_SHORT_MS * 3));
    expect(region()).toBeInTheDocument();
    fireEvent.pointerLeave(toast);
    fireEvent.focus(screen.getByRole("button", { name: "Dismiss" }));
    act(() => vi.advanceTimersByTime(TOAST_SHORT_MS * 3));
    expect(region()).toBeInTheDocument();
    fireEvent.blur(screen.getByRole("button", { name: "Dismiss" }));
    act(() => vi.advanceTimersByTime(TOAST_SHORT_MS));
    expect(region()).not.toBeInTheDocument();
  });

  it("dismisses on Escape", () => {
    act(() => show({ tone: "error", message: "disk is read-only" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Dismiss" }), { key: "Escape" });
    expect(region()).not.toBeInTheDocument();
  });

  it("updates a keyed progress toast in place and keeps it open", () => {
    act(() => show({ key: "save", message: "Saving directly…", progress: 10 }));
    const toast = region();
    act(() => show({ key: "save", message: "Saving directly…", progress: 55 }));
    expect(region()).toBe(toast);
    expect(screen.getByRole("progressbar", { name: "Saving directly…" })).toHaveAttribute("value", "55");
    act(() => vi.advanceTimersByTime(TOAST_LONG_MS * 10));
    expect(region()).toBeInTheDocument();
    act(() => show({ key: "save", message: "Remote file saved." }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_SHORT_MS));
    expect(region()).not.toBeInTheDocument();
  });

  it("dismisses by key only when that toast is showing", () => {
    act(() => show({ key: "add-input", tone: "error", message: "Not a magnet link" }));
    act(() => dismiss("other"));
    expect(region()).toBeInTheDocument();
    act(() => dismiss("add-input"));
    expect(region()).not.toBeInTheDocument();
  });
});
