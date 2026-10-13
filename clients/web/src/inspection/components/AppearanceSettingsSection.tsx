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
      <div
        className={styles.settingGroup}
        role="group"
        aria-labelledby="color-theme-heading"
      >
        <div className={styles.settingHeading}>
          <strong id="color-theme-heading">{localizedMessage("inspection.components.appearance.settings.section.color.theme")}</strong>
          <span>{localizedMessage("inspection.components.appearance.settings.section.choose.a.palette.or.follow.your.system")}</span>
        </div>
        <div className={styles.options}>
          {COLOR_THEME_OPTIONS.map((option) => (
            <label key={option.value} className={styles.option}>
              <input
                type="radio"
                name="color-theme"
                value={option.value}
                checked={colorTheme === option.value}
                onChange={() => onColorThemeChange(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div
        className={styles.settingGroup}
        role="group"
        aria-labelledby="interface-size-heading"
      >
        <div className={styles.settingHeading}>
          <strong id="interface-size-heading">{localizedMessage("inspection.components.appearance.settings.section.interface.size")}</strong>
          <span>{localizedMessage("inspection.components.appearance.settings.section.changes.apply.immediately")}</span>
        </div>
        <div className={styles.options}>
          {INTERFACE_SIZE_OPTIONS.map((option) => (
            <label key={option.value} className={styles.option}>
              <input
                type="radio"
                name="interface-size"
                value={option.value}
                checked={interfaceSize === option.value}
                onChange={() => onInterfaceSizeChange(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div
        className={styles.settingGroup}
        role="group"
        aria-labelledby="data-units-heading"
      >
        <div className={styles.settingHeading}>
          <strong id="data-units-heading">{localizedMessage("inspection.components.appearance.settings.section.size.units")}</strong>
          <span>{localizedMessage("inspection.components.appearance.settings.section.changes.apply.immediately")}</span>
        </div>
        <div className={styles.options}>
          {DATA_UNITS_OPTIONS.map((option) => (
            <label key={option.value} className={styles.option}>
              <input
                type="radio"
                name="data-units"
                value={option.value}
                checked={dataUnits === option.value}
                onChange={() => onDataUnitsChange(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
