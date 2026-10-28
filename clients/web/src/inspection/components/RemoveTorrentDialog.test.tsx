// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { setProductLocaleForTest } from "../../localization/runtime";
import { buildScenarioSnapshot } from "../demo/catalog";
import type { TorrentRow } from "../model";
import { RemoveTorrentDialog } from "./RemoveTorrentDialog";

vi.hoisted(() => { vi.stubEnv("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES", "1"); });
afterAll(() => { vi.unstubAllEnvs(); });

const base = Object.values(buildScenarioSnapshot("healthy-download", 42000, false, 1).torrents)[0]!;
let restore: (() => void) | undefined;
afterEach(() => { cleanup(); restore?.(); });

function targets(count: number): TorrentRow[] {
  return Array.from({ length: count }, (_, index) => ({
    ...base, id: `torrent-${index}`, name: `Torrent ${index}`, deleteDataSupported: true,
  }));
}

function dialog(rows: readonly TorrentRow[], onConfirm = vi.fn(async () => {})) {
  return <RemoveTorrentDialog targets={rows} deleteDataSupported={rows.every(row => row.deleteDataSupported)}
    returnFocus={() => {}} onCancel={() => {}} onConfirm={onConfirm} />;
}

it("renders a complete German sentence while keeping the supplied torrent name as safe bold text", () => {
  restore = setProductLocaleForTest("de");
  const name = '<img src=x onerror="alert(1)"> {count}';
  const view = render(dialog([{ ...base, name }]));
  const strong = screen.getByText(name);
  expect(strong.tagName).toBe("STRONG");
  expect(strong.closest("p")).toHaveTextContent(`${name} aus JSTorrent entfernen.`);
  expect(view.container.querySelector("img")).toBeNull();
});

it("uses German plurals for additional names, unsupported deletion, and destructive warnings", async () => {
  restore = setProductLocaleForTest("de");
  const user = userEvent.setup();
  const rows = targets(6);
  const view = render(dialog(rows));
  expect(screen.getByRole("dialog", { name: "6 Torrents entfernen?" })).toBeVisible();
  expect(screen.getByText("und 1 weiterer Torrent")).toBeVisible();
  await user.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("alert")).toHaveTextContent("dieser Torrents");
  view.rerender(dialog([{ ...rows[0]!, deleteDataSupported: false }]));
  expect(screen.getByText(/1 ausgewählter Torrent unterstützt/)).toBeVisible();
  view.rerender(dialog(rows.map(row => ({ ...row, deleteDataSupported: false }))));
  expect(screen.getByText(/6 ausgewählte Torrents unterstützen/)).toBeVisible();
  view.rerender(dialog([rows[0]!]));
  await user.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("alert")).toHaveTextContent("dieses Torrents");
});

it.each([1, 2])("announces pending removal of %i torrents in German without submitting twice", async (count) => {
  restore = setProductLocaleForTest("de");
  const user = userEvent.setup();
  let finish!: () => void;
  const onConfirm = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(dialog(targets(count), onConfirm));
  await user.click(screen.getByRole("button", { name: /^Entfernen$/ }));
  expect(screen.getByRole("button", { name: `${count} ${count === 1 ? "wird" : "werden"} entfernt…` })).toBeDisabled();
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(false);
  await act(async () => { finish(); });
});
