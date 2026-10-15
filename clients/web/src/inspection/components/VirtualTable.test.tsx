// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  TableToolbarSlot,
  VirtualTable,
  type VirtualColumn,
} from "./VirtualTable";

interface Row {
  readonly id: string;
  readonly value: string | null;
}

const COLUMNS: readonly VirtualColumn<Row>[] = [
  {
    id: "value",
    label: "Value",
    width: 140,
    sortKind: "decimal",
    sortValue: (row) => row.value,
    headerHelp: <p>Values are exact decimal strings.</p>,
    render: (row) => row.value ?? "—",
  },
  {
    id: "optional",
    label: "Optional",
    width: 100,
    defaultVisible: false,
    render: () => "extra",
  },
];

const storedValues = new Map<string, string>();
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (callback) => {
    return window.setTimeout(() => callback(0), 0);
  };
  globalThis.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear: () => storedValues.clear(),
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => storedValues.set(key, value),
    } satisfies Pick<Storage, "clear" | "getItem" | "setItem">,
  });
});

afterAll(() => {
  if (originalLocalStorage === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
  else Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (typeof globalThis.localStorage?.clear === "function") {
    globalThis.localStorage.clear();
  }
});

describe("VirtualTable", () => {
  it("shows hidden placeholder rows only while loading with no rows", () => {
    const table = (rows: readonly Row[], loading: boolean) => (
      <VirtualTable
        tableId="placeholder-test"
        label="Loading rows"
        rows={rows}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="Loading rows…"
        loading={loading}
      />
    );
    const rendered = render(table([], true));
    const grid = screen.getByRole("grid", { name: "Loading rows" });
    const placeholders = screen.getByTestId("table-placeholders");
    expect(grid).toHaveAttribute("aria-busy", "true");
    expect(placeholders.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryAllByRole("row")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Loading rows…");

    rendered.rerender(table([{ id: "a", value: "1" }], true));
    expect(screen.queryByTestId("table-placeholders")).not.toBeInTheDocument();
    expect(grid).not.toHaveAttribute("aria-busy");
    expect(screen.getAllByRole("row")).toHaveLength(2);

    rendered.rerender(table([], false));
    expect(screen.queryByTestId("table-placeholders")).not.toBeInTheDocument();
    expect(screen.getByText("Loading rows…")).toBeVisible();
  });

  it("preserves manual scrolling across refreshed and reordered rows", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      value: String(index),
    }));
    const table = (currentRowId: string | null, values = rows) => (
      <VirtualTable
        tableId="refresh-scroll-test"
        label="Refreshing rows"
        rows={values}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        currentRowId={currentRowId}
        emptyMessage="empty"
      />
    );
    const rendered = render(table("row-0"));
    const grid = screen.getByRole("grid", { name: "Refreshing rows" });
    Object.defineProperty(grid, "clientHeight", { value: 360 });
    grid.scrollTop = 1800;
    fireEvent.scroll(grid);
    rendered.rerender(
      table("row-0", rows.map((row) => ({ ...row, value: "updated" }))),
    );
    expect(grid.scrollTop).toBe(1800);
    rendered.rerender(table("row-0", [...rows].reverse()));
    expect(grid.scrollTop).toBe(1800);

    rendered.rerender(table("row-90"));
    expect(grid.scrollTop).toBeGreaterThan(1800);
    rendered.rerender(table(null));
    grid.scrollTop = 1800;
    fireEvent.scroll(grid);
    rendered.rerender(table("row-90"));
    expect(grid.scrollTop).toBeGreaterThan(1800);
    rendered.rerender(table("row-0"));
    expect(grid.scrollTop).toBe(0);
    grid.scrollTop = 1800;
    fireEvent.scroll(grid);
    rendered.rerender(table("not-yet-loaded"));
    expect(grid.scrollTop).toBe(1800);
    rendered.rerender(table("row-0"));
    expect(grid.scrollTop).toBe(0);
  });

  it("reveals a pending selection when its row arrives, then preserves scrolling", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      value: String(index),
    }));
    const table = (values: readonly Row[]) => (
      <VirtualTable
        tableId="pending-selection-scroll-test"
        label="Pending rows"
        rows={values}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        currentRowId="row-90"
        emptyMessage="empty"
      />
    );
    const rendered = render(table([]));
    const grid = screen.getByRole("grid", { name: "Pending rows" });
    Object.defineProperty(grid, "clientHeight", { value: 360 });
    rendered.rerender(table(rows));
    expect(grid.scrollTop).toBeGreaterThan(1800);
    grid.scrollTop = 1800;
    fireEvent.scroll(grid);
    rendered.rerender(table(rows.map((row) => ({ ...row }))));
    expect(grid.scrollTop).toBe(1800);
  });

  it("keeps table shortcuts on the grid after clearing selection in empty space", () => {
    function Table() {
      const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
        new Set(),
      );
      const [currentRowId, setCurrentRowId] = useState<string | null>(null);
      return (
        <VirtualTable
          tableId="background-focus-test"
          label="Torrent library"
          rows={[
            { id: "one", value: "1" },
            { id: "two", value: "2" },
          ]}
          getRowId={(row) => row.id}
          columns={COLUMNS}
          interfaceSize="standard"
          currentRowId={currentRowId}
          emptyMessage="empty"
          selection={{
            selectedIds,
            getRowLabel: (row) => row.id,
            onChange: (nextSelectedIds, nextCurrentId) => {
              setSelectedIds(new Set(nextSelectedIds));
              setCurrentRowId(nextCurrentId);
            },
          }}
        />
      );
    }

    render(<Table />);
    const grid = screen.getByRole("grid", { name: "Torrent library" });
    fireEvent.click(grid);
    expect(grid).toHaveFocus();

    expect(fireEvent.keyDown(document.activeElement!, {
      key: "a",
      metaKey: true,
    })).toBe(false);
    expect(checkedRowNames()).toEqual(["all rows", "one", "two"]);
    expect(screen.getByText("2 selected")).toBeVisible();

    fireEvent.click(grid);
    expect(grid).toHaveFocus();
    expect(checkedRowNames()).toEqual([]);
    fireEvent.keyDown(document.activeElement!, { key: "a", ctrlKey: true });
    expect(checkedRowNames()).toEqual(["all rows", "one", "two"]);
  });

  it("sorts decimal u64 strings exactly and keeps null last in both directions", () => {
    const { container } = render(
      <VirtualTable
        tableId="sort-test"
        label="Exact decimal sorting"
        rows={[
          { id: "null", value: null },
          { id: "large", value: "9007199254740993" },
          { id: "ten", value: "10" },
        ]}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="empty"
      />,
    );
    const value = screen.getByRole("button", { name: "Value" });
    fireEvent.click(value);
    expect(rowIds(container)).toEqual(["ten", "large", "null"]);
    fireEvent.click(value);
    expect(rowIds(container)).toEqual(["large", "ten", "null"]);
  });

  it("re-sorts live updates except while the user interacts with the table", () => {
    vi.useFakeTimers();
    const table = (values: readonly [string, string, string]) => (
      <VirtualTable
        tableId="live-sort-test"
        label="Live sorting"
        rows={["a", "b", "c"].map((id, index) => ({ id, value: values[index]! }))}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="empty"
        initialSort={{ columnId: "value", direction: "asc" }}
      />
    );
    const rendered = render(table(["1", "2", "3"]));
    const grid = screen.getByRole("grid", { name: "Live sorting" });
    const indicator = () =>
      rendered.container.querySelector<HTMLElement>("[data-held]")!;
    expect(rowIds(rendered.container)).toEqual(["a", "b", "c"]);

    rendered.rerender(table(["3", "2", "1"]));
    expect(rowIds(rendered.container)).toEqual(["c", "b", "a"]);
    expect(indicator()).toHaveAttribute("data-held", "false");

    fireEvent.pointerMove(grid, { pointerType: "mouse" });
    rendered.rerender(table(["1", "2", "3"]));
    expect(rowIds(rendered.container)).toEqual(["c", "b", "a"]);
    expect(indicator()).toHaveAttribute("data-held", "true");

    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(rowIds(rendered.container)).toEqual(["c", "b", "a"]);
    expect(indicator()).toHaveAttribute("data-held", "false");
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    expect(rowIds(rendered.container)).toEqual(["a", "b", "c"]);
    rendered.rerender(table(["3", "2", "1"]));
    expect(rowIds(rendered.container)).toEqual(["a", "b", "c"]);
    expect(indicator()).toHaveAttribute("data-held", "true");

    fireEvent.pointerLeave(grid, { pointerType: "mouse" });
    expect(rowIds(rendered.container)).toEqual(["c", "b", "a"]);
    expect(indicator()).toHaveAttribute("data-held", "false");

    fireEvent.pointerDown(grid, { pointerType: "touch" });
    fireEvent.pointerLeave(grid, { pointerType: "touch" });
    rendered.rerender(table(["1", "2", "3"]));
    expect(rowIds(rendered.container)).toEqual(["c", "b", "a"]);
    act(() => vi.advanceTimersByTime(2000));
    expect(rowIds(rendered.container)).toEqual(["a", "b", "c"]);
    vi.useRealTimers();
  });

  it("opens column help without sorting and restores focus on Escape", async () => {
    render(
      <VirtualTable
        tableId="help-test"
        label="Column help"
        rows={[{ id: "one", value: "1" }]}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="empty"
      />,
    );
    const help = screen.getByRole("button", { name: "Explain Value" });
    const header = screen.getByRole("columnheader", { name: "Value" });
    help.focus();
    fireEvent.click(help);
    expect(header).not.toHaveAttribute("aria-sort");
    expect(help).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("dialog", { name: "Value column help" }),
    ).toHaveTextContent("exact decimal strings");
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "Value column help" }),
      { key: "Escape" },
    );
    expect(
      screen.queryByRole("dialog", { name: "Value column help" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(help).toHaveFocus());
  });

  it("hides optional columns by default and exposes persisted controls", () => {
    const first = render(
      <VirtualTable
        tableId="columns-test"
        label="Column configuration"
        rows={[{ id: "one", value: "1" }]}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="empty"
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Optional" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Optional" }));
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "Table column settings" }),
      { key: "Escape" },
    );
    expect(screen.getByRole("columnheader", { name: /Optional/ })).toBeVisible();
    first.unmount();

    render(
      <VirtualTable
        tableId="columns-test"
        label="Restored column configuration"
        rows={[{ id: "one", value: "1" }]}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="empty"
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Optional/ })).toBeVisible();
  });

  it("reconciles stale hidden columns and clamps persisted widths", () => {
    storedValues.set(
      "rstorrent.table.stale-test",
      JSON.stringify({
        version: 1,
        hiddenColumns: ["value", "optional", "removed"],
        widths: { value: 50_000, removed: 12 },
        sort: { columnId: "removed", direction: "asc" },
        liveSort: true,
      }),
    );
    render(
      <VirtualTable
        tableId="stale-test"
        label="Reconciled column configuration"
        rows={[{ id: "one", value: "1" }]}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="empty"
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Value" })).toBeVisible();
    expect(screen.getByRole("separator", { name: "Resize Value column" })).toHaveAttribute(
      "aria-valuenow",
      "720",
    );
  });

  it("updates absolute row geometry with the selected interface size", () => {
    const table = (interfaceSize: "compact" | "spacious") => (
      <VirtualTable
        tableId="size-test"
        label="Interface size geometry"
        rows={[
          { id: "one", value: "1" },
          { id: "two", value: "2" },
          { id: "three", value: "3" },
        ]}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize={interfaceSize}
        emptyMessage="empty"
      />
    );
    const rendered = render(table("compact"));
    const root = () => rendered.container.firstElementChild as HTMLElement;
    const second = () =>
      rendered.container.querySelector<HTMLElement>('[data-row-id="two"]');
    expect(root().style.getPropertyValue("--ui-table-header-height")).toBe("34px");
    expect(root().style.getPropertyValue("--ui-table-row-height")).toBe("32px");
    expect(second()).toHaveStyle({ transform: "translateY(32px)" });

    rendered.rerender(table("spacious"));
    expect(root().style.getPropertyValue("--ui-table-header-height")).toBe("44px");
    expect(root().style.getPropertyValue("--ui-table-row-height")).toBe("42px");
    expect(second()).toHaveStyle({ transform: "translateY(42px)" });
  });

  it("keeps current checked and makes row bodies singleton selection", () => {
    function SelectableTable() {
      const rows = [
        { id: "one", value: "1" },
        { id: "two", value: "2" },
      ];
      const [currentId, setCurrentId] = useState<string | null>("one");
      const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
        new Set(["one"]),
      );
      return (
        <VirtualTable
          tableId="selection-test"
          label="Selectable rows"
          rows={rows}
          getRowId={(row) => row.id}
          columns={COLUMNS}
          interfaceSize="standard"
          emptyMessage="empty"
          currentRowId={currentId}
          onClearCurrent={() => setCurrentId(null)}
          selection={{
            selectedIds,
            getRowLabel: (row) => row.id,
            onChange: (nextSelectedIds, nextCurrentId) => {
              setSelectedIds(new Set(nextSelectedIds));
              setCurrentId(nextCurrentId);
            },
          }}
        />
      );
    }

    render(<SelectableTable />);
    const grid = screen.getByRole("grid", { name: "Selectable rows" });
    expect(grid).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getByRole("checkbox", { name: "Deselect one" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select two" })).not.toBeChecked();
    expect(screen.getByRole("row", { name: /1/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("row", { name: /1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select two" }).parentElement!,
    );
    expect(screen.getByRole("checkbox", { name: "Deselect two" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Deselect one" })).toBeChecked();
    expect(screen.getByText("2 selected")).toBeVisible();
    const masterSelection = screen.getByRole("checkbox", {
      name: "Deselect all rows",
    });
    expect(masterSelection).toBeChecked();

    fireEvent.click(screen.getByRole("row", { name: /Deselect two/ }));
    expect(screen.getByRole("checkbox", { name: "Select one" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Deselect two" })).toBeChecked();
    expect(screen.getByRole("row", { name: /2/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.queryByText("2 selected")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: /Select one/ }), {
      ctrlKey: true,
    });
    expect(screen.getByText("2 selected")).toBeVisible();
    expect(screen.getByRole("row", { name: /2/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Done selecting rows in Selectable rows",
      }),
    );
    expect(screen.getByRole("checkbox", { name: "Select one" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Deselect two" })).toBeChecked();
    fireEvent.click(grid);
    expect(screen.getByRole("checkbox", { name: "Select two" })).not.toBeChecked();
    expect(screen.queryByRole("row", { current: true })).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("row", { name: /Select one/ }));
    expect(screen.getByRole("checkbox", { name: "Deselect one" })).toBeChecked();
    expect(screen.getByRole("row", { name: /Deselect one/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("replaces forward and reverse Shift ranges in sorted row order", () => {
    function RangeTable() {
      const rows = ["one", "two", "three", "four", "five"].map(
        (id, index) => ({ id, value: String(index + 1) }),
      );
      const [currentRowId, setCurrentRowId] = useState<string | null>("two");
      const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
        new Set(["two"]),
      );
      return (
        <VirtualTable
          tableId="range-test"
          label="Range rows"
          rows={rows}
          getRowId={(row) => row.id}
          columns={COLUMNS}
          interfaceSize="standard"
          currentRowId={currentRowId}
          emptyMessage="empty"
          selection={{
            selectedIds,
            getRowLabel: (row) => row.id,
            onChange: (nextSelectedIds, nextCurrentId) => {
              setSelectedIds(new Set(nextSelectedIds));
              setCurrentRowId(nextCurrentId);
            },
          }}
        />
      );
    }

    render(<RangeTable />);
    fireEvent.click(screen.getByRole("row", { name: /4/ }), { shiftKey: true });
    expect(checkedRowNames()).toEqual(["two", "three", "four"]);
    expect(screen.getByRole("row", { name: /4/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    fireEvent.click(screen.getByRole("row", { name: /3/ }), { shiftKey: true });
    expect(checkedRowNames()).toEqual(["two", "three"]);

    fireEvent.click(screen.getByRole("row", { name: /5/ }));
    fireEvent.click(screen.getByRole("row", { name: /3/ }), { shiftKey: true });
    expect(checkedRowNames()).toEqual(["three", "four", "five"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Deselect four" }), {
      shiftKey: true,
    });
    expect(checkedRowNames()).toEqual(["four", "five"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Done selecting rows in Range rows" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    fireEvent.click(screen.getByRole("row", { name: /2/ }));
    fireEvent.click(screen.getByRole("row", { name: /4/ }), { shiftKey: true });
    expect(checkedRowNames()).toEqual(["four", "three", "two"]);
  });

  it("makes bare navigation singleton and extends keyboard selection ranges", async () => {
    function KeyboardTable() {
      const rows = ["one", "two", "three", "four", "five"].map(
        (id, index) => ({ id, value: String(index + 1) }),
      );
      const [currentRowId, setCurrentRowId] = useState<string | null>("two");
      const [selectedIds, setSelectedIds] = useState<
        ReadonlySet<string>
      >(new Set(["two"]));
      return (
        <VirtualTable
          tableId="keyboard-range-test"
          label="Keyboard rows"
          rows={rows}
          getRowId={(row) => row.id}
          columns={COLUMNS}
          interfaceSize="standard"
          currentRowId={currentRowId}
          emptyMessage="empty"
          selection={{
            selectedIds,
            getRowLabel: (row) => row.id,
            onChange: (nextSelectedIds, nextCurrentId) => {
              setSelectedIds(new Set(nextSelectedIds));
              setCurrentRowId(nextCurrentId);
            },
          }}
        />
      );
    }

    render(<KeyboardTable />);
    const grid = screen.getByRole("grid", { name: "Keyboard rows" });
    const current = () =>
      screen.getAllByRole("row").find((row) => row.getAttribute("aria-current") === "true");
    screen.getByRole("row", { name: /2/ }).focus();

    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(current()).toHaveAttribute("data-row-id", "three");
    await waitFor(() => expect(current()).toHaveFocus());
    expect(checkedRowNames()).toEqual(["three"]);

    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(current()).toHaveAttribute("data-row-id", "four");
    expect(checkedRowNames()).toEqual(["three", "four"]);
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(checkedRowNames()).toEqual(["three", "four", "five"]);
    fireEvent.keyDown(grid, { key: "ArrowUp", shiftKey: true });
    expect(checkedRowNames()).toEqual(["three", "four"]);
    fireEvent.keyDown(grid, { key: "Home", shiftKey: true });
    expect(current()).toHaveAttribute("data-row-id", "one");
    expect(checkedRowNames()).toEqual(["one", "two", "three"]);

    fireEvent.keyDown(grid, { key: "a", metaKey: true });
    expect(screen.getByText("5 selected")).toBeVisible();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(current()).toHaveAttribute("data-row-id", "two");
    expect(checkedRowNames()).toEqual(["two"]);
    expect(screen.queryByText("5 selected")).not.toBeInTheDocument();
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(checkedRowNames()).toEqual(["two"]);
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(current()).toHaveAttribute("data-row-id", "two");
    expect(checkedRowNames()).toEqual(["two"]);

    const nestedCheckbox = screen.getByRole("checkbox", { name: "Select one" });
    nestedCheckbox.focus();
    fireEvent.keyDown(nestedCheckbox, { key: "a", ctrlKey: true });
    expect(current()).toHaveAttribute("data-row-id", "two");
    expect(screen.getByRole("row", { name: /2/ })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(
      screen.queryByText("5 selected"),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(grid, { key: "a", ctrlKey: true });
    expect(screen.getByText("5 selected")).toBeVisible();
  });

  it("selects offscreen logical rows and discloses hidden targets", () => {
    function LargeTable() {
      const rows = Array.from({ length: 200 }, (_, index) => ({
        id: `row-${index}`,
        value: String(index),
      }));
      const [currentRowId, setCurrentRowId] = useState<string | null>("row-0");
      const [selectedIds, setSelectedIds] = useState<
        ReadonlySet<string>
      >(new Set(["outside-current-view", "row-0"]));
      return (
        <VirtualTable
          tableId="logical-select-all-test"
          label="Logical rows"
          rows={rows}
          getRowId={(row) => row.id}
          columns={COLUMNS}
          interfaceSize="standard"
          currentRowId={currentRowId}
          emptyMessage="empty"
          selection={{
            selectedIds,
            getRowLabel: (row) => row.id,
            onChange: (nextSelectedIds, nextCurrentId) => {
              setSelectedIds(new Set(nextSelectedIds));
              setCurrentRowId(nextCurrentId);
            },
          }}
        />
      );
    }

    render(<LargeTable />);
    const grid = screen.getByRole("grid", { name: "Logical rows" });
    expect(screen.getByText("2 selected (1 not shown)")).toBeVisible();
    expect(grid.querySelectorAll('[role="row"]').length).toBeLessThan(100);
    grid.querySelector<HTMLElement>('[data-row-id="row-0"]')?.focus();
    fireEvent.keyDown(grid, { key: "a", ctrlKey: true });
    expect(screen.getByText("200 selected")).toBeVisible();
    expect(grid.querySelectorAll('[role="row"]').length).toBeLessThan(100);
  });

  it("falls back to the clicked row when the range anchor disappears", () => {
    function FilteredRangeTable() {
      const [rows, setRows] = useState([
        { id: "one", value: "1" },
        { id: "two", value: "2" },
        { id: "three", value: "3" },
      ]);
      const [currentRowId, setCurrentRowId] = useState<string | null>("two");
      const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
        new Set(["two"]),
      );
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setRows((current) =>
                current.filter((row) => row.id !== "two"),
              )
            }
          >
            Hide anchor
          </button>
          <VirtualTable
            tableId="missing-anchor-test"
            label="Filtered rows"
            rows={rows}
            getRowId={(row) => row.id}
            columns={COLUMNS}
            interfaceSize="standard"
            currentRowId={currentRowId}
            emptyMessage="empty"
            selection={{
              selectedIds,
              getRowLabel: (row) => row.id,
              onChange: (nextSelectedIds, nextCurrentId) => {
                setSelectedIds(new Set(nextSelectedIds));
                setCurrentRowId(nextCurrentId);
              },
            }}
          />
        </>
      );
    }

    render(<FilteredRangeTable />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Deselect two" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide anchor" }));
    fireEvent.click(screen.getByRole("row", { name: /3/ }), { shiftKey: true });
    expect(checkedRowNames()).toEqual(["three"]);
  });

  it("toggles selection on a stationary touch hold and cancels on movement", () => {
    vi.useFakeTimers();
    const change = vi.fn();
    render(
      <VirtualTable
        tableId="long-press-test"
        label="Touch rows"
        rows={[{ id: "one", value: "1" }]}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="empty"
        selection={{
          selectedIds: new Set(),
          getRowLabel: (row) => row.id,
          onChange: change,
        }}
      />,
    );
    const row = screen.getByRole("row", { name: /1/ });
    fireEvent.pointerDown(row, {
      button: 0,
      pointerId: 1,
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 21, clientY: 10 });
    act(() => vi.advanceTimersByTime(500));
    expect(change).not.toHaveBeenCalled();

    fireEvent.pointerDown(row, {
      button: 0,
      pointerId: 2,
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    act(() => vi.advanceTimersByTime(500));
    expect(change).toHaveBeenCalledWith(["one"], "one");
    vi.useRealTimers();
  });
});

interface Item {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly size: number;
  readonly note: string | null;
}

const ITEMS: readonly Item[] = [
  { id: "a", name: "Alpha", state: "Seeding", size: 3, note: null },
  { id: "b", name: "Bravo", state: "Paused", size: 9, note: "slow" },
];

const LIST_COLUMNS: readonly VirtualColumn<Item>[] = [
  {
    id: "state",
    label: "State",
    width: 100,
    listRole: "subtitle",
    sortValue: (item) => item.state,
    render: (item) => item.state,
  },
  {
    id: "name",
    label: "Name",
    width: 200,
    listRole: "title",
    sortValue: (item) => item.name,
    render: (item) => item.name,
  },
  {
    id: "size",
    label: "Size",
    width: 80,
    listRole: "detail",
    sortValue: (item) => item.size,
    render: (item) => `${item.size} MB`,
  },
  {
    id: "note",
    label: "Note",
    width: 80,
    listRole: "detail",
    sortValue: (item) => item.note,
    render: (item) => item.note ?? "—",
  },
  {
    id: "hidden",
    label: "Hidden",
    width: 80,
    render: () => "table only",
  },
];

describe("VirtualTable external sort", () => {
  it("reports header sorts and keeps the caller's order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <VirtualTable
        tableId="external"
        label="External rows"
        rows={[
          { id: "b", value: "2" },
          { id: "a", value: "10" },
        ]}
        getRowId={(row) => row.id}
        columns={COLUMNS}
        interfaceSize="standard"
        emptyMessage="No rows"
        externalSort={{ sort: { columnId: "value", direction: "asc" }, onChange }}
      />,
    );
    const grid = screen.getByRole("grid", { name: "External rows" });
    expect(
      within(grid)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["2", "10"]);
    await user.click(within(grid).getByRole("button", { name: /^Value/ }));
    expect(onChange).toHaveBeenCalledWith({ columnId: "value", direction: "desc" });
  });
});

describe("VirtualTable narrow list", () => {
  const originalMatchMedia = window.matchMedia;

  beforeAll(() => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });

  afterAll(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("stacks role columns into one item and sorts from the toolbar", () => {
    const { container } = render(
      <VirtualTable
        tableId="list-test"
        label="Items"
        rows={ITEMS}
        getRowId={(item) => item.id}
        columns={LIST_COLUMNS}
        interfaceSize="standard"
        emptyMessage="None"
      />,
    );

    expect(screen.queryAllByRole("columnheader")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
    const [alpha, bravo] = screen.getAllByRole("gridcell");
    expect(alpha).toHaveTextContent(/^AlphaSeedingSize 3 MB$/);
    expect(bravo).toHaveTextContent(/^BravoPausedSize 9 MBNote slow$/);
    expect(container).not.toHaveTextContent("table only");

    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "size" },
    });
    expect(rowIds(container)).toEqual(["a", "b"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Sorted ascending; switch to descending" }),
    );
    expect(rowIds(container)).toEqual(["b", "a"]);
  });

  it("opens a row, or toggles it while several are selected", () => {
    const activate = vi.fn();
    const change = vi.fn();
    const table = (selected: readonly string[]) => (
      <VirtualTable
        tableId="list-selection"
        label="Items"
        rows={ITEMS}
        getRowId={(item) => item.id}
        columns={LIST_COLUMNS}
        interfaceSize="standard"
        currentRowId="a"
        selection={{
          selectedIds: new Set(selected),
          getRowLabel: (item) => item.name,
          onChange: change,
        }}
        onActivate={activate}
        emptyMessage="None"
      />
    );
    const { rerender } = render(table(["a"]));
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    fireEvent.click(screen.getByRole("row", { name: /Bravo/ }));
    expect(activate).toHaveBeenCalledTimes(1);

    activate.mockClear();
    change.mockClear();
    rerender(table(["a", "b"]));
    expect(checkedRowNames()).toEqual(["Alpha", "Bravo"]);
    fireEvent.click(screen.getByRole("row", { name: /Bravo/ }));
    expect(activate).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledWith(["a"], "a");
  });
});

describe("VirtualTable toolbar slot", () => {
  it("moves its count and controls into the provided bar", () => {
    const slot = document.createElement("div");
    document.body.append(slot);
    render(
      <TableToolbarSlot.Provider value={slot}>
        <VirtualTable
          tableId="slot-test"
          label="Items"
          rows={ITEMS}
          getRowId={(item) => item.id}
          columns={LIST_COLUMNS}
          interfaceSize="standard"
          formatCount={(count) => `${count} items`}
          emptyMessage="None"
        />
      </TableToolbarSlot.Provider>,
    );
    expect(slot).toHaveTextContent("2 items");
    expect(slot).toContainElement(screen.getByRole("button", { name: "Columns" }));
    slot.remove();
  });
});

function rowIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[data-row-id]")].map(
    (element) => element.dataset.rowId ?? "",
  );
}

function checkedRowNames(): string[] {
  return screen
    .getAllByRole("checkbox")
    .filter((checkbox) => checkbox.getAttribute("aria-label")?.startsWith("Deselect "))
    .map((checkbox) => checkbox.getAttribute("aria-label")!.slice("Deselect ".length));
}
