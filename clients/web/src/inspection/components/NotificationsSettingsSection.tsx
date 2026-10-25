import { message as localizedMessage } from "../../localization/runtime";
import { useState } from "react";

import type {
  DesktopNotifications,
  DesktopNotificationSettings,
} from "../desktop-notifications/types";
import styles from "./SettingsDialog.module.css";

export interface NotificationsSettingsSectionProps {
  readonly notifications: DesktopNotifications;
}

type SettingName = keyof DesktopNotificationSettings;

const OPTIONS: readonly {
  readonly setting: SettingName;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    setting: "notify_download_complete",
    get label() { return localizedMessage("inspection.components.notifications.settings.section.download.complete"); },
    get description() { return localizedMessage("inspection.components.notifications.settings.section.when.a.download.finishes"); },
  },
  {
    setting: "notify_needs_attention",
    get label() { return localizedMessage("inspection.components.notifications.settings.section.download.needs.attention"); },
    get description() { return localizedMessage("inspection.components.notifications.settings.section.when.a.torrent.needs.action"); },
  },
  {
    setting: "notify_while_focused",
    get label() { return localizedMessage("inspection.components.notifications.settings.section.notify.while.rstorrent.is.focused"); },
    get description() { return localizedMessage("inspection.components.notifications.settings.section.also.notify.while.using"); },
  },
];

export function NotificationsSettingsSection({
  notifications,
}: NotificationsSettingsSectionProps) {
  const [settings, setSettings] = useState(notifications.getSnapshot);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (setting: SettingName, checked: boolean) => {
    if (pending) return;
    const previous = settings;
    const next = { ...settings, [setting]: checked };
    setSettings(next);
    setPending(true);
    setError(null);
    try {
      setSettings(await notifications.save(next));
    } catch (cause) {
      setSettings(previous);
      setError(localizedMessage("feedback.notifications.save.failed", { error: errorMessage(cause) }));
    } finally {
      setPending(false);
    }
  };

  return (
    <fieldset className={styles.section} disabled={pending}>
      <legend>{localizedMessage("inspection.components.notifications.settings.section.notifications")}</legend>
      <div className={styles.rows}>
        {OPTIONS.map((option) => (
          <label className={styles.preference} key={option.setting}>
            <input
              type="checkbox"
              checked={settings[option.setting]}
              onChange={(event) =>
                void change(option.setting, event.currentTarget.checked)
              }
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
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
