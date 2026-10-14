import { message as localizedMessage } from "../../localization/runtime";
import { useState } from "react";

import type { DesktopPower } from "../desktop-power/types";
import styles from "./SettingsDialog.module.css";

export interface PowerSettingsSectionProps {
  readonly power: DesktopPower;
}

export function PowerSettingsSection({ power }: PowerSettingsSectionProps) {
  const [settings, setSettings] = useState(power.getSnapshot);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (checked: boolean) => {
    if (pending) return;
    const previous = settings;
    const next = {
      ...settings,
      prevent_sleep_during_active_downloads: checked,
    };
    setSettings(next);
    setPending(true);
    setError(null);
    try {
      setSettings(await power.save(next));
    } catch (cause) {
      setSettings(previous);
      setError(localizedMessage("feedback.power.save.failed", { error: errorMessage(cause) }));
    } finally {
      setPending(false);
    }
  };

  return (
    <fieldset className={styles.section} disabled={pending}>
      <legend>{localizedMessage("inspection.components.power.settings.section.power")}</legend>
      <p className={styles.sectionIntroduction}>{localizedMessage("inspection.components.power.settings.section.keeps.computer.awake")}</p>
      <div className={styles.rows}>
        <label className={styles.preference}>
          <input
            type="checkbox"
            checked={settings.prevent_sleep_during_active_downloads}
            onChange={(event) => void change(event.currentTarget.checked)}
          />
          <span>
            <strong>{localizedMessage("inspection.components.power.settings.section.prevent.sleep.while.downloading")}</strong>
          </span>
        </label>
      </div>
      {error === null ? null : (
        <p className={styles.errorStatus} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
