import type { ReactNode } from "react";

import { SegmentedControl } from "./SegmentedControl";
import styles from "./SettingsDialog.module.css";

export interface SegmentedOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly description: string;
}

/** One row: title and the chosen option's description, then native radios drawn as segments. */
export function SegmentedSetting<Value extends string>({
  name,
  title,
  options,
  value,
  disabled = false,
  children,
  onChange,
}: {
  readonly name: string;
  readonly title: string;
  readonly options: readonly SegmentedOption<Value>[];
  readonly value: Value;
  readonly disabled?: boolean;
  /** Extra heading lines under the chosen option's description. */
  readonly children?: ReactNode;
  readonly onChange: (value: Value) => void;
}) {
  const headingId = `${name}-heading`;
  const descriptionId = `${name}-description`;
  const selected = options.find((option) => option.value === value);
  return (
    <div
      className={styles.choiceRow}
      role="group"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <div className={styles.settingHeading}>
        <strong id={headingId}>{title}</strong>
        <span id={descriptionId}>{selected?.description}</span>
        {children}
      </div>
      <SegmentedControl
        name={name}
        options={options}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
