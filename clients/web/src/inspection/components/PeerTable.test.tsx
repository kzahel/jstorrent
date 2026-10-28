// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { useStore } from "zustand";
import { setProductLocaleForTest } from "../../localization/runtime";
import { buildScenarioSnapshot } from "../demo/catalog";
import type { PeerRow, PeerState } from "../model";
import { createInspectionStore, type InspectionStore } from "../state";
import { PeerTable } from "./PeerTable";

vi.hoisted(() => { vi.stubEnv("VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES", "1"); });
afterAll(() => { vi.unstubAllEnvs(); });

const store = createInspectionStore(null);
vi.mock("../context", () => ({
  useInspectionStore: <T,>(selector: (state: InspectionStore) => T) => useStore(store, selector),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("updates all peer-state labels live while preserving internal states and selected peer", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const fixture = buildScenarioSnapshot("healthy-download", 42000, false, 1);
  const base = Object.values(Object.values(fixture.peersByTorrent)[0]!.rows)[0]!;
  const states: PeerState[] = ["connecting", "handshaking", "connected", "choked", "stalled", "disconnecting"];
  const rows: PeerRow[] = states.map((state, index) => ({ ...base, torrentId: "fixture", connectionId: `peer-${index}`, state }));
  store.setState({
    peersByTorrent: { fixture: { order: rows.map(row => row.connectionId), rows: Object.fromEntries(rows.map(row => [row.connectionId, row])) } },
    presentation: { ...store.getState().presentation, currentPeerId: "peer-2" },
  });
  const restoreEnglish = setProductLocaleForTest("en");
  let restoreGerman: (() => void) | undefined;
  try {
    const view = render(<PeerTable torrentId="fixture" />);
    expect(screen.getByText("Choked")).toBeVisible();
    act(() => { restoreGerman = setProductLocaleForTest("de"); });
    const labels = ["Verbindungsaufbau", "Handshake", "Verbunden", "Blockiert", "Stockt", "Verbindung wird getrennt"];
    for (const [index, state] of states.entries()) {
      expect(view.container.querySelector(`[data-state="${state}"]`)).toHaveTextContent(labels[index]!);
    }
    expect(view.container.querySelector('[data-state="choked"]')).toHaveTextContent("Blockiert");
    expect(store.getState().presentation.currentPeerId).toBe("peer-2");
    expect(store.getState().peersByTorrent.fixture!.order.map(id => store.getState().peersByTorrent.fixture!.rows[id]!.state)).toEqual(states);
  } finally {
    act(() => { restoreGerman?.(); restoreEnglish(); });
  }
});
