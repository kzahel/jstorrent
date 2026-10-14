import { useState } from "react";
import { message as localizedMessage } from "../../localization/runtime";

import { useToast } from "./Toast";
import styles from "./SettingsDialog.module.css";

interface DataResetSettingsSectionProps {
  readonly manageable: boolean;
  readonly deleteDataSupported: boolean;
  readonly onRestoreDefaults: () => Promise<void>;
  readonly onClearAppData: (deleteData: boolean) => Promise<void>;
  readonly onBusyChange: (busy: boolean) => void;
}

export function DataResetSettingsSection({
  manageable,
  deleteDataSupported,
  onRestoreDefaults,
  onClearAppData,
  onBusyChange,
}: DataResetSettingsSectionProps) {
  const [confirmation, setConfirmation] = useState<"restore" | "clear" | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const run = async () => {
    if (confirmation === null || pending) return;
    setPending(true);
    onBusyChange(true);
    setError(null);
    try {
      if (confirmation === "restore") {
        await onRestoreDefaults();
        toast.show({ message: localizedMessage("inspection.components.data.reset.preferences.restored") });
      } else {
        await onClearAppData(deleteData);
        toast.show({ message: localizedMessage("inspection.components.data.reset.app.data.cleared") });
      }
      setConfirmation(null);
      setDeleteData(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
      onBusyChange(false);
    }
  };

  return (
    <div className={styles.dataReset}>
      <h3>{localizedMessage("inspection.components.data.reset.category")}</h3>
      <div className={styles.rows}>
        <section>
          <h4>{localizedMessage("inspection.components.data.reset.restore.title")}</h4>
          <p>{localizedMessage("inspection.components.data.reset.restore.description")}</p>
          <button type="button" disabled={!manageable || pending} onClick={() => { setConfirmation("restore"); setError(null); }}>{localizedMessage("inspection.components.data.reset.restore.open")}</button>
        </section>
        <section>
          <h4>{localizedMessage("inspection.components.data.reset.clear.title")}</h4>
          <p>{localizedMessage("inspection.components.data.reset.clear.description")}</p>
          <button type="button" disabled={!manageable || pending} onClick={() => { setConfirmation("clear"); setDeleteData(false); setError(null); }}>{localizedMessage("inspection.components.data.reset.clear.open")}</button>
        </section>
      </div>
      {confirmation === null ? null : (
        <div className={styles.resetConfirmation} role="group" aria-label={confirmation === "restore" ? localizedMessage("inspection.components.data.reset.restore.confirm") : localizedMessage("inspection.components.data.reset.clear.confirm")}>
          <strong>{confirmation === "restore" ? localizedMessage("inspection.components.data.reset.restore.confirm") : localizedMessage("inspection.components.data.reset.clear.confirm")}</strong>
          <p>{confirmation === "restore"
            ? localizedMessage("inspection.components.data.reset.restore.warning")
            : localizedMessage("inspection.components.data.reset.clear.warning")}</p>
          {confirmation === "clear" ? (
            <label>
              <input type="checkbox" checked={deleteData} disabled={!deleteDataSupported || pending} onChange={(event) => setDeleteData(event.currentTarget.checked)} />
              {localizedMessage("inspection.components.data.reset.delete.files")}
            </label>
          ) : null}
          {confirmation === "clear" && !deleteDataSupported ? <p>{localizedMessage("inspection.components.data.reset.delete.unavailable")}</p> : null}
          {confirmation === "clear" && deleteData ? <p>{localizedMessage("inspection.components.data.reset.delete.scope")}</p> : null}
          <div className={styles.resetActions}>
            <button type="button" disabled={pending} onClick={() => { setConfirmation(null); setDeleteData(false); }}>{localizedMessage("inspection.components.data.reset.cancel")}</button>
            <button type="button" disabled={pending} onClick={() => void run()}>{pending ? localizedMessage("inspection.components.data.reset.working") : confirmation === "restore" ? localizedMessage("inspection.components.data.reset.restore.action") : localizedMessage("inspection.components.data.reset.clear.action")}</button>
          </div>
        </div>
      )}
      {error === null ? null : <p role="alert" className={styles.errorStatus}>{error}</p>}
    </div>
  );
}
