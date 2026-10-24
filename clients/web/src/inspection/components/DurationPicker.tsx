import { message as localizedMessage } from "../../localization/runtime";
import { useState } from "react";

import {
  DURATION_PRESETS_SECONDS,
  DURATION_UNIT_SECONDS,
  SEED_STOP_VALUE_MAXIMUM,
  durationLabel,
  durationParts,
  durationSeconds,
  type DurationLimitDraft,
  type DurationUnit,
} from "../seed-stop";
import { NumberInput } from "./NumberInput";
import styles from "./PresetPicker.module.css";

export interface DurationPreset {
  readonly seconds: number;
  readonly label: string;
}

interface DurationPickerProps {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly draft: DurationLimitDraft;
  readonly error: string | null;
  readonly disabled: boolean;
  /** Offers Use global with this label, such as "Use global (1 day)". */
  readonly useGlobalLabel?: string;
  /** Offers Off with this label, such as "Off" or "No limit". */
  readonly offLabel?: string;
  /** Choices before the standard presets, such as "No time goal". */
  readonly leadingPresets?: readonly DurationPreset[];
  /** Keeps a seconds unit for a stored value that is not whole minutes. */
  readonly secondsUnit?: boolean;
  readonly onChange: (value: DurationLimitDraft) => void;
}

const CUSTOM_UNITS: readonly DurationUnit[] = ["minutes", "hours", "days"];
const DEFAULT_CUSTOM_SECONDS = 86_400;

/**
 * A duration: Use global, Off, a preset, or a custom whole number of minutes,
 * hours or days. Every choice edits the same draft that validation turns into
 * exact seconds.
 */
export function DurationPicker({
  id,
  label,
  description,
  draft,
  error,
  disabled,
  useGlobalLabel,
  offLabel,
  leadingPresets = [],
  secondsUnit = false,
  onChange,
}: DurationPickerProps) {
  const [customChosen, setCustomChosen] = useState(false);
  const presets: readonly DurationPreset[] = [
    ...leadingPresets,
    ...DURATION_PRESETS_SECONDS.map((seconds) => ({
      seconds,
      label: durationLabel(seconds),
    })),
  ];
  const seconds = durationSeconds(draft.value, draft.unit);
  const preset = presets.find((candidate) => candidate.seconds === seconds) ?? null;
  const choice =
    draft.mode !== "limited"
      ? draft.mode
      : customChosen || preset === null
        ? "custom"
        : String(preset.seconds);
  const units =
    secondsUnit || draft.unit === "seconds"
      ? (["seconds", ...CUSTOM_UNITS] as const)
      : CUSTOM_UNITS;
  const choiceId = `${id}-choice`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label htmlFor={choiceId}>
        <strong>{label}</strong>
        {description === undefined ? null : (
          <small id={descriptionId}>{description}</small>
        )}
      </label>
      <div className={styles.controls}>
        <select
          id={choiceId}
          aria-label={label}
          value={choice}
          disabled={disabled}
          aria-describedby={description === undefined ? undefined : descriptionId}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setCustomChosen(next === "custom");
            if (next === "use_global" || next === "off") {
              onChange({ ...draft, mode: next });
            } else if (next === "custom") {
              // A choice such as "No time goal" is not a useful custom start.
              const leading = leadingPresets.some((candidate) => candidate.seconds === seconds);
              onChange(
                leading
                  ? { mode: "limited", ...durationParts(DEFAULT_CUSTOM_SECONDS) }
                  : { ...draft, mode: "limited" },
              );
            } else {
              onChange({ mode: "limited", ...durationParts(Number(next)) });
            }
          }}
        >
          {useGlobalLabel === undefined ? null : (
            <option value="use_global">{useGlobalLabel}</option>
          )}
          {offLabel === undefined ? null : <option value="off">{offLabel}</option>}
          {presets.map((candidate) => (
            <option key={candidate.seconds} value={String(candidate.seconds)}>
              {candidate.label}
            </option>
          ))}
          <option value="custom">
            {localizedMessage("inspection.seed.stop.custom")}
          </option>
        </select>
        {choice === "custom" ? (
          <span className={styles.custom}>
            <NumberInput
              id={id}
              label={localizedMessage("inspection.seed.stop.duration.custom.label", { label })}
              minimum={0}
              maximum={Math.floor(SEED_STOP_VALUE_MAXIMUM / DURATION_UNIT_SECONDS[draft.unit])}
              step={1}
              value={draft.value}
              disabled={disabled}
              invalid={error !== null}
              describedBy={error === null ? undefined : errorId}
              onChange={(value) => onChange({ ...draft, mode: "limited", value })}
            />
            <select
              aria-label={localizedMessage("inspection.seed.stop.duration.unit.label", { label })}
              value={draft.unit}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  mode: "limited",
                  unit: event.currentTarget.value as DurationUnit,
                })
              }
            >
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabel(unit)}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>
      {error === null ? null : (
        <small id={errorId} className={styles.error}>
          {error}
        </small>
      )}
    </div>
  );
}

function unitLabel(unit: DurationUnit): string {
  switch (unit) {
    case "seconds":
      return localizedMessage("inspection.seed.stop.unit.seconds");
    case "minutes":
      return localizedMessage("inspection.seed.stop.unit.minutes");
    case "hours":
      return localizedMessage("inspection.seed.stop.unit.hours");
    case "days":
      return localizedMessage("inspection.seed.stop.unit.days");
  }
}
