import { message as localizedMessage } from "../../localization/runtime";
import type { ColorTheme, DataUnits, InterfaceSize } from "../appearance";
import styles from "./SettingsDialog.module.css";

const COLOR_THEME_OPTIONS: readonly {
  readonly value: ColorTheme;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: "auto",
    label: localizedMessage("inspection.components.appearance.settings.section.auto"),
    description: localizedMessage("inspection.components.appearance.settings.section.follow.your.system.appearance"),
  },
  {
    value: "light",
    label: localizedMessage("inspection.components.appearance.settings.section.light"),
    description: localizedMessage("inspection.components.appearance.settings.section.always.use.the.light.appearance"),
  },
  {
    value: "dark",
    label: localizedMessage("inspection.components.appearance.settings.section.dark"),
    description: localizedMessage("inspection.components.appearance.settings.section.always.use.the.dark.appearance"),
  },
];

const INTERFACE_SIZE_OPTIONS: readonly {
  readonly value: InterfaceSize;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: "compact",
    label: localizedMessage("inspection.components.appearance.settings.section.compact"),
    description: localizedMessage("inspection.components.appearance.settings.section.fit.more.information.on.screen"),
  },
  {
    value: "standard",
    label: localizedMessage("inspection.components.appearance.settings.section.standard"),
    description: localizedMessage("inspection.components.appearance.settings.section.balanced.text.controls.and.table.spacing"),
  },
  {
    value: "spacious",
    label: localizedMessage("inspection.components.appearance.settings.section.spacious"),
    description: localizedMessage("inspection.components.appearance.settings.section.use.larger.text.and.more.generous.targets"),
  },
];

const DATA_UNITS_OPTIONS: readonly {
  readonly value: DataUnits;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: "binary",
    label: localizedMessage("inspection.components.appearance.settings.section.units.binary"),
    description: localizedMessage("inspection.components.appearance.settings.section.units.binary.description"),
  },
  {
    value: "decimal",
    label: localizedMessage("inspection.components.appearance.settings.section.units.decimal"),
    description: localizedMessage("inspection.components.appearance.settings.section.units.decimal.description"),
  },
];

interface AppearanceSettingsSectionProps {
  readonly colorTheme: ColorTheme;
  readonly interfaceSize: InterfaceSize;
  readonly dataUnits: DataUnits;
  readonly onColorThemeChange: (colorTheme: ColorTheme) => void;
  readonly onInterfaceSizeChange: (interfaceSize: InterfaceSize) => void;
  readonly onDataUnitsChange: (dataUnits: DataUnits) => void;
}

export function AppearanceSettingsSection({
  colorTheme,
  interfaceSize,
  dataUnits,
  onColorThemeChange,
  onInterfaceSizeChange,
  onDataUnitsChange,
}: AppearanceSettingsSectionProps) {
  return (
    <fieldset className={styles.section}>
      <legend>{localizedMessage("inspection.components.appearance.settings.section.appearance")}</legend>
      <div className={styles.rows}>
        <SegmentedSetting
          name="color-theme"
          title={localizedMessage("inspection.components.appearance.settings.section.color.theme")}
          options={COLOR_THEME_OPTIONS}
          value={colorTheme}
          onChange={onColorThemeChange}
        />
        <SegmentedSetting
          name="interface-size"
          title={localizedMessage("inspection.components.appearance.settings.section.interface.size")}
          options={INTERFACE_SIZE_OPTIONS}
          value={interfaceSize}
          onChange={onInterfaceSizeChange}
        />
        <SegmentedSetting
          name="data-units"
          title={localizedMessage("inspection.components.appearance.settings.section.size.units")}
          options={DATA_UNITS_OPTIONS}
          value={dataUnits}
          onChange={onDataUnitsChange}
        />
      </div>
    </fieldset>
  );
}

/** One row: title and the chosen option's description, then native radios drawn as segments. */
function SegmentedSetting<Value extends string>({
  name,
  title,
  options,
  value,
  onChange,
}: {
  readonly name: string;
  readonly title: string;
  readonly options: readonly {
    readonly value: Value;
    readonly label: string;
    readonly description: string;
  }[];
  readonly value: Value;
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
      </div>
      <div className={styles.segmented}>
        {options.map((option) => (
          <label key={option.value} className={styles.segment} title={option.description}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
