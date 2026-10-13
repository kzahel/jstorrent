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
    label: localizedMessage("inspection.components.notifications.settings.section.download.complete"),
    description: localizedMessage("inspection.components.notifications.settings.section.when.a.download.finishes"),
  },
  {
    setting: "notify_needs_attention",
    label: localizedMessage("inspection.components.notifications.settings.section.download.needs.attention"),
    description: localizedMessage("inspection.components.notifications.settings.section.when.a.torrent.needs.action"),
  },
  {
    setting: "notify_while_focused",
    label: localizedMessage("inspection.components.notifications.settings.section.notify.while.rstorrent.is.focused"),
    description:
      localizedMessage("inspection.components.notifications.settings.section.also.notify.while.using"),
  },
];

export function NotificationsSettingsSection({
  notifications,
}: NotificationsSettingsSectionProps) {
  const [settings, setSettings] = useState(notifications.getSnapshot);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<
    { readonly type: "success" | "error"; readonly message: string } | null
  >(null);

  const change = async (setting: SettingName, checked: boolean) => {
    if (pending) return;
    const previous = settings;
    const next = { ...settings, [setting]: checked };
    setSettings(next);
    setPending(true);
    setStatus(null);
    try {
      setSettings(await notifications.save(next));
      setStatus({ type: "success", message: localizedMessage("inspection.components.notifications.settings.section.notification.settings.saved") });
    } catch (error) {
      setSettings(previous);
      setStatus({
        type: "error",
        message: `Notification settings were not saved: ${errorMessage(error)}`,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <fieldset className={styles.section} disabled={pending}>
      <legend>{localizedMessage("inspection.components.notifications.settings.section.notifications")}</legend>
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
      {status === null ? null : (
        <p
          className={
            status.type === "error" ? styles.errorStatus : styles.successStatus
          }
          role={status.type === "error" ? "alert" : "status"}
        >
          {status.message}
        </p>
      )}
    </fieldset>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
