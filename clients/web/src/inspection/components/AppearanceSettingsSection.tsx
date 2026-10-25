import { useLayoutEffect, useRef, useState } from "react";
import {
  message as localizedMessage,
  availableProductLanguages,
  languagePreferenceSnapshot,
  setLanguagePreference,
  useProductLocale,
  type LanguagePreference,
} from "../../localization/runtime";
import type { ColorTheme, DataUnits, InterfaceSize } from "../appearance";
import { SegmentedSetting, type SegmentedOption } from "./SegmentedSetting";
import styles from "./SettingsDialog.module.css";

const COLOR_THEME_OPTIONS: readonly SegmentedOption<ColorTheme>[] = [
  {
    value: "auto",
    get label() { return localizedMessage("inspection.components.appearance.settings.section.auto"); },
    get description() { return localizedMessage("inspection.components.appearance.settings.section.follow.your.system.appearance"); },
  },
  {
    value: "light",
    get label() { return localizedMessage("inspection.components.appearance.settings.section.light"); },
    get description() { return localizedMessage("inspection.components.appearance.settings.section.always.use.the.light.appearance"); },
  },
  {
    value: "dark",
    get label() { return localizedMessage("inspection.components.appearance.settings.section.dark"); },
    get description() { return localizedMessage("inspection.components.appearance.settings.section.always.use.the.dark.appearance"); },
  },
];

const INTERFACE_SIZE_OPTIONS: readonly SegmentedOption<InterfaceSize>[] = [
  {
    value: "compact",
    get label() { return localizedMessage("inspection.components.appearance.settings.section.compact"); },
    get description() { return localizedMessage("inspection.components.appearance.settings.section.fit.more.information.on.screen"); },
  },
  {
    value: "standard",
    get label() { return localizedMessage("inspection.components.appearance.settings.section.standard"); },
    get description() { return localizedMessage("inspection.components.appearance.settings.section.balanced.text.controls.and.table.spacing"); },
  },
  {
    value: "spacious",
    get label() { return localizedMessage("inspection.components.appearance.settings.section.spacious"); },
    get description() { return localizedMessage("inspection.components.appearance.settings.section.use.larger.text.and.more.generous.targets"); },
  },
];

const DATA_UNITS_OPTIONS: readonly SegmentedOption<DataUnits>[] = [
  {
    value: "binary",
    get label() { return localizedMessage("inspection.components.appearance.settings.section.units.binary"); },
    get description() { return localizedMessage("inspection.components.appearance.settings.section.units.binary.description"); },
  },
  {
    value: "decimal",
    get label() { return localizedMessage("inspection.components.appearance.settings.section.units.decimal"); },
    get description() { return localizedMessage("inspection.components.appearance.settings.section.units.decimal.description"); },
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
  const currentLocale = useProductLocale();
  const [languagePending, setLanguagePending] = useState(false);
  const [languageFailed, setLanguageFailed] = useState(false);
  const languageFocus = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    if (languagePending) return;
    const control = languageFocus.current;
    languageFocus.current = null;
    if (control?.isConnected && document.activeElement === document.body) control.focus();
  }, [languagePending]);
  const availableLanguages = availableProductLanguages();
  const languageOptions = [
    { value: "system" as const, label: localizedMessage("localization.language.system"), description: localizedMessage("localization.language.description") },
    ...availableLanguages.map((locale) => ({
      value: locale,
      label: new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale,
      description: localizedMessage("localization.language.description"),
    })),
  ];
  const preference = languagePreferenceSnapshot();
  const selectedLanguage = languageOptions.some((option) => option.value === preference)
    ? preference : availableLanguages.find((locale) => locale === currentLocale) ?? availableLanguages[0] ?? "system";
  const changeLanguage = async (preference: LanguagePreference) => {
    const focused = document.activeElement;
    languageFocus.current = focused instanceof HTMLInputElement && focused.name === "language" ? focused : null;
    setLanguagePending(true);
    setLanguageFailed(false);
    try { await setLanguagePreference(preference); }
    catch { setLanguageFailed(true); }
    finally { setLanguagePending(false); }
  };
  return (
    <fieldset className={styles.section}>
      <legend>{localizedMessage("inspection.components.appearance.settings.section.appearance")}</legend>
      <div className={styles.rows}>
        <SegmentedSetting<LanguagePreference>
          name="language"
          title={localizedMessage("localization.language.title")}
          options={languageOptions}
          value={selectedLanguage}
          disabled={languagePending}
          onChange={(preference) => { void changeLanguage(preference); }}
          onReselect={(choice) => { if (preference !== selectedLanguage) void changeLanguage(choice); }}
        >
          {languageFailed ? <span role="alert">{localizedMessage("localization.language.save-failed")}</span> : null}
        </SegmentedSetting>
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
