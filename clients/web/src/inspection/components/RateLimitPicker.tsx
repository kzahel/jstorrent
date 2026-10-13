import { message as localizedMessage } from "../../localization/runtime";
import { useState, type ReactNode } from "react";

import {
  RATE_LIMIT_MAXIMUM_BYTES,
  RATE_LIMIT_PRESETS_KB,
  rateLabel,
  rateLimitPreset,
} from "../transfer-rate";
import styles from "./RateLimitPicker.module.css";

export interface RateLimitDraft {
  readonly unlimited: boolean;
  readonly valueKiB: string;
}

interface RateLimitPickerProps extends RateLimitDraft {
  readonly id: string;
  readonly label: string;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly note?: ReactNode;
  readonly onChange: (value: RateLimitDraft) => void;
}

/**
 * Unlimited, a preset, or a custom KB/s value. Every choice edits the same
 * exact draft text that validation turns into bytes per second.
 */
export function RateLimitPicker({
  id,
  label,
  unlimited,
  valueKiB,
  error,
  disabled,
  note,
  onChange,
}: RateLimitPickerProps) {
  const [customChosen, setCustomChosen] = useState(false);
  const preset = rateLimitPreset(valueKiB);
  const choice = unlimited
    ? "unlimited"
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
            if (next === "unlimited") {
              onChange({ unlimited: true, valueKiB });
            } else if (next === "custom") {
              onChange({ unlimited: false, valueKiB });
            } else {
              onChange({ unlimited: false, valueKiB: next });
            }
          }}
        >
          <option value="unlimited">
            {localizedMessage("inspection.components.rate.limit.picker.unlimited")}
          </option>
          {RATE_LIMIT_PRESETS_KB.map((kilobytes) => (
            <option key={kilobytes} value={String(kilobytes)}>
              {rateLabel(kilobytes)}
            </option>
          ))}
          <option value="custom">
            {localizedMessage("inspection.components.rate.limit.picker.custom")}
          </option>
        </select>
        {choice === "custom" ? (
          <span className={styles.custom}>
            <input
              id={id}
              aria-label={localizedMessage("inspection.components.rate.limit.picker.custom.label", { label })}
              type="number"
              inputMode="decimal"
              min={1}
              max={RATE_LIMIT_MAXIMUM_BYTES / 1_024}
              step={1 / 1_024}
              required
              value={valueKiB}
              disabled={disabled}
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : errorId}
              onChange={(event) =>
                onChange({ unlimited: false, valueKiB: event.currentTarget.value })
              }
            />
            <span aria-hidden="true">
              {localizedMessage("inspection.components.rate.limit.picker.unit")}
            </span>
          </span>
        ) : null}
      </div>
      {note}
      {error === null ? null : (
        <small id={errorId} className={styles.error}>
          {error}
        </small>
      )}
    </div>
  );
}
