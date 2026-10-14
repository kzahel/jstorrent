import styles from "./PresetPicker.module.css";

interface NumberInputProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly unit?: string | undefined;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly decimal?: boolean;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly describedBy?: string | undefined;
  readonly onChange: (value: string) => void;
}

/**
 * A settings number field that fills the control column. A unit sits inside
 * the field's box, so a long unit never shifts the field.
 */
export function NumberInput({
  id,
  label,
  value,
  unit,
  minimum,
  maximum,
  step,
  decimal = false,
  disabled,
  invalid,
  describedBy,
  onChange,
}: NumberInputProps) {
  const input = (
    <input
      id={id}
      className={unit === undefined ? styles.plainInput : undefined}
      aria-label={label}
      type="number"
      inputMode={decimal ? "decimal" : "numeric"}
      step={step}
      min={minimum}
      max={maximum}
      required
      value={value}
      disabled={disabled}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
  if (unit === undefined) return input;
  return (
    <span className={styles.unitInput}>
      {input}
      <span aria-hidden="true">{unit}</span>
    </span>
  );
}
