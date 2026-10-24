import { message as localizedMessage } from "../../localization/runtime";
import { useState } from "react";

import {
  RATIO_PRESETS_PERCENT,
  SEED_STOP_VALUE_MAXIMUM,
  ratioLabel,
  ratioPercent,
  ratioText,
  type RatioLimitDraft,
} from "../seed-stop";
import { NumberInput } from "./NumberInput";
import styles from "./PresetPicker.module.css";

interface RatioPickerProps {
  readonly id: string;
  readonly label: string;
  readonly draft: RatioLimitDraft;
  readonly error: string | null;
  readonly disabled: boolean;
  /** Offers Use global with this label, such as "Use global (2.0)". */
  readonly useGlobalLabel?: string;
  /** Offers Off with this label, such as "Off" or "No limit". */
  readonly offLabel?: string;
  readonly onChange: (value: RatioLimitDraft) => void;
}

/**
 * A share ratio: Use global, Off, a preset or a custom ratio with up to two
 * decimals. Every choice edits the same draft text that validation turns
 * into an exact percent.
 */
export function RatioPicker({
  id,
  label,
  draft,
  error,
  disabled,
  useGlobalLabel,
  offLabel,
  onChange,
}: RatioPickerProps) {
  const [customChosen, setCustomChosen] = useState(false);
  const percent = ratioPercent(draft.ratio);
  const preset = RATIO_PRESETS_PERCENT.find((value) => value === percent) ?? null;
  const choice =
    draft.mode !== "limited"
      ? draft.mode
      : customChosen || preset === null
        ? "custom"
        : String(preset);
  const choiceId = `${id}-choice`;
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label htmlFor={choiceId}>
        <strong>{label}</strong>
      </label>
      <div className={styles.controls}>
        <select
          id={choiceId}
          value={choice}
          disabled={disabled}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setCustomChosen(next === "custom");
            if (next === "use_global" || next === "off") {
              onChange({ ...draft, mode: next });
            } else if (next === "custom") {
              onChange({ ...draft, mode: "limited" });
            } else {
              onChange({ mode: "limited", ratio: ratioText(Number(next)) });
            }
          }}
        >
          {useGlobalLabel === undefined ? null : (
            <option value="use_global">{useGlobalLabel}</option>
          )}
          {offLabel === undefined ? null : <option value="off">{offLabel}</option>}
          {RATIO_PRESETS_PERCENT.map((value) => (
            <option key={value} value={String(value)}>
              {ratioLabel(value)}
            </option>
          ))}
          <option value="custom">
            {localizedMessage("inspection.seed.stop.custom")}
          </option>
        </select>
        {choice === "custom" ? (
          <NumberInput
            id={id}
            label={localizedMessage("inspection.seed.stop.ratio.custom.label", { label })}
            minimum={0}
            maximum={Math.floor(SEED_STOP_VALUE_MAXIMUM / 100)}
            step={0.01}
            decimal
            value={draft.ratio}
            disabled={disabled}
            invalid={error !== null}
            describedBy={error === null ? undefined : errorId}
            onChange={(ratio) => onChange({ mode: "limited", ratio })}
          />
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
