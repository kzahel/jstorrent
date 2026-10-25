import styles from "./SegmentedControl.module.css";

export interface SegmentedControlOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly description?: string;
}

/** Native radios drawn as segments; the choice is one of `options`. */
export function SegmentedControl<Value extends string>({
  name,
  label,
  options,
  value,
  disabled = false,
  onChange,
  onReselect,
}: {
  readonly name: string;
  /** Accessible name when no visible heading labels the group. */
  readonly label?: string;
  readonly options: readonly SegmentedControlOption<Value>[];
  readonly value: Value;
  readonly disabled?: boolean;
  readonly onChange: (value: Value) => void;
  /** Explicitly selecting an already active effective value can replace an unavailable saved override. */
  readonly onReselect?: ((value: Value) => void) | undefined;
}) {
  return (
    <div className={styles.segmented} role={label === undefined ? undefined : "radiogroup"} aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={styles.segment} title={option.description}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            onClick={() => { if (option.value === value) onReselect?.(option.value); }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
