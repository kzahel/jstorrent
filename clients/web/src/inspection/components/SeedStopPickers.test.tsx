// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  validateDurationLimit,
  validateRatioLimit,
  type DurationLimitDraft,
  type RatioLimitDraft,
} from "../seed-stop";
import { DurationPicker } from "./DurationPicker";
import { RatioPicker } from "./RatioPicker";

afterEach(cleanup);

/** Holds the draft and shows what validation would save. */
function Duration({
  initial,
  secondsUnit = false,
  withGoal = false,
}: {
  readonly initial: DurationLimitDraft;
  readonly secondsUnit?: boolean;
  readonly withGoal?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const validation = validateDurationLimit(draft);
  return (
    <>
      <DurationPicker
        id="time"
        label="Seeding time"
        draft={draft}
        error={validation.error}
        disabled={false}
        offLabel="Off"
        secondsUnit={secondsUnit}
        {...(withGoal
          ? { leadingPresets: [{ seconds: 2_147_483_647, label: "No time goal" }] }
          : {})}
        onChange={setDraft}
      />
      <output>{JSON.stringify(validation.limit)}</output>
    </>
  );
}

function Ratio({ initial }: { readonly initial: RatioLimitDraft }) {
  const [draft, setDraft] = useState(initial);
  const validation = validateRatioLimit(draft);
  return (
    <>
      <RatioPicker
        id="ratio"
        label="Share ratio"
        draft={draft}
        error={validation.error}
        disabled={false}
        useGlobalLabel="Use global (Off)"
        offLabel="No limit"
        onChange={setDraft}
      />
      <output>{JSON.stringify(validation.limit)}</output>
    </>
  );
}

const saved = () => JSON.parse(screen.getByRole("status").textContent ?? "null");

describe("duration picker", () => {
  it("round-trips presets and custom values as exact seconds", async () => {
    const user = userEvent.setup();
    render(<Duration initial={{ mode: "off", value: "1", unit: "days" }} />);
    const choice = screen.getByRole("combobox", { name: "Seeding time" });
    expect(choice).toHaveValue("off");
    expect(
      Array.from(choice.querySelectorAll("option"), (option) => option.textContent),
    ).toEqual([
      "Off",
      "1 hour",
      "6 hours",
      "1 day",
      "3 days",
      "1 week",
      "30 days",
      "Custom…",
    ]);

    await user.selectOptions(choice, "1 week");
    expect(saved()).toEqual({ type: "limited", value: 604_800 });

    // Custom starts from the chosen preset and stays Custom while edited.
    await user.selectOptions(choice, "Custom…");
    const value = screen.getByRole("spinbutton", { name: "Seeding time, custom time" });
    const unit = screen.getByRole("combobox", { name: "Seeding time, unit" });
    expect(value).toHaveValue(7);
    expect(unit).toHaveValue("days");
    expect(
      Array.from(unit.querySelectorAll("option"), (option) => option.value),
    ).toEqual(["minutes", "hours", "days"]);
    await user.selectOptions(unit, "hours");
    await user.clear(value);
    await user.type(value, "6");
    expect(choice).toHaveValue("custom");
    expect(saved()).toEqual({ type: "limited", value: 21_600 });

    fireEvent.change(value, { target: { value: "1.5" } });
    expect(value).toHaveAttribute("aria-invalid", "true");
    expect(value).toHaveAccessibleDescription(/whole number from 0 to 596,523/);
    expect(saved()).toBeNull();

    await user.selectOptions(choice, "Off");
    expect(saved()).toEqual({ type: "off" });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("opens a stored non-preset value as Custom with a seconds unit only when needed", () => {
    render(
      <Duration
        initial={{ mode: "limited", value: "3601", unit: "seconds" }}
        secondsUnit
      />,
    );
    expect(screen.getByRole("combobox", { name: "Seeding time" })).toHaveValue("custom");
    expect(
      screen.getByRole("spinbutton", { name: "Seeding time, custom time" }),
    ).toHaveValue(3_601);
    const unit = screen.getByRole("combobox", { name: "Seeding time, unit" });
    expect(unit).toHaveValue("seconds");
    expect(
      Array.from(unit.querySelectorAll("option"), (option) => option.value),
    ).toEqual(["seconds", "minutes", "hours", "days"]);
  });

  it("maps a leading goal choice to its stored value", async () => {
    const user = userEvent.setup();
    render(
      <Duration
        initial={{ mode: "limited", value: "2147483647", unit: "seconds" }}
        withGoal
      />,
    );
    const choice = screen.getByRole("combobox", { name: "Seeding time" });
    expect(choice).toHaveDisplayValue("No time goal");
    await user.selectOptions(choice, "Custom…");
    // A custom value starts from one day rather than the goal's sentinel.
    expect(
      screen.getByRole("spinbutton", { name: "Seeding time, custom time" }),
    ).toHaveValue(1);
    expect(saved()).toEqual({ type: "limited", value: 86_400 });
    await user.selectOptions(choice, "No time goal");
    expect(saved()).toEqual({ type: "limited", value: 2_147_483_647 });
  });
});

describe("ratio picker", () => {
  it("offers Use global, No limit, presets and a two-decimal custom ratio", async () => {
    const user = userEvent.setup();
    render(<Ratio initial={{ mode: "use_global", ratio: "2" }} />);
    const choice = screen.getByRole("combobox", { name: "Share ratio" });
    expect(
      Array.from(choice.querySelectorAll("option"), (option) => option.textContent),
    ).toEqual([
      "Use global (Off)",
      "No limit",
      "1.0",
      "1.5",
      "2.0",
      "3.0",
      "5.0",
      "Custom…",
    ]);
    expect(saved()).toEqual({ type: "use_global" });

    await user.selectOptions(choice, "1.5");
    expect(saved()).toEqual({ type: "limited", value: 150 });
    await user.selectOptions(choice, "No limit");
    expect(saved()).toEqual({ type: "off" });

    await user.selectOptions(choice, "Custom…");
    const custom = screen.getByRole("spinbutton", { name: "Share ratio, custom ratio" });
    fireEvent.change(custom, { target: { value: "2.5" } });
    expect(saved()).toEqual({ type: "limited", value: 250 });
    fireEvent.change(custom, { target: { value: "0" } });
    expect(saved()).toEqual({ type: "limited", value: 0 });
    fireEvent.change(custom, { target: { value: "1.234" } });
    expect(saved()).toBeNull();
    expect(screen.getByText(/with up to two decimals/)).toBeVisible();
  });
});
